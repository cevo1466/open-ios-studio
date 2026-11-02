//! App Store Connect API client (no Tauri). Endpoints and request/response shapes were
//! checked against Apple's OpenAPI specification v4.5.1; no call has been made against a real
//! account yet (NOT_VERIFIED until a paid Apple Developer account exists).
//!
//! Safety rules enforced here:
//!   * ES256 JWT, lifetime <= 20 minutes, created per request, never logged;
//!   * API calls only go to `https://api.appstoreconnect.apple.com`;
//!   * upload URLs handed out by Apple must be `https`, and the JWT is NEVER sent to them;
//!   * no destructive call exists in this module (nothing revokes or deletes).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::pkcs8::DecodePrivateKey;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const API_BASE: &str = "https://api.appstoreconnect.apple.com";
const TOKEN_LIFETIME_SECS: u64 = 600; // Apple allows up to 1200
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const PART_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_PARTS: usize = 10_000;

#[derive(Debug, thiserror::Error)]
pub enum AscError {
    #[error("API anahtarı geçersiz: {0}")]
    Key(String),
    #[error("Ağ hatası: {0}")]
    Network(String),
    #[error("Apple {status}: {title} ({code}) {detail}")]
    Api {
        status: u16,
        code: String,
        title: String,
        detail: String,
    },
    #[error("Apple'dan beklenmeyen yanıt: {0}")]
    Shape(String),
    #[error("Yükleme reddedildi: {0}")]
    Upload(String),
    #[error("Dosya okunamadı: {0}")]
    Io(String),
    #[error("İşlem {0} sn içinde bitmedi; App Store Connect'te durumu kontrol et.")]
    Timeout(u64),
}

#[derive(Clone)]
pub struct Credentials {
    pub issuer_id: String,
    pub key_id: String,
    /// Contents of the `.p8` file (PKCS#8 PEM). Kept in memory only; never logged.
    pub private_key_pem: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("issuer_id", &self.issuer_id)
            .field("key_id", &self.key_id)
            .field("private_key_pem", &"<hidden>")
            .finish()
    }
}

/// Basic shape checks before a key is ever stored.
pub fn validate_credentials(c: &Credentials) -> Result<(), String> {
    let alnum = |s: &str, n: std::ops::RangeInclusive<usize>| {
        n.contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    };
    if !alnum(&c.issuer_id, 30..=40) {
        return Err("Issuer ID biçimi yanlış (UUID gibi olmalı).".into());
    }
    if !alnum(&c.key_id, 8..=12) {
        return Err("Key ID biçimi yanlış (10 karakterlik kimlik).".into());
    }
    SigningKey::from_pkcs8_pem(&c.private_key_pem)
        .map(|_| ())
        .map_err(|_| ".p8 içeriği geçerli bir EC özel anahtarı değil.".to_string())
}

fn b64(v: &Value) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(v).unwrap_or_default())
}

/// ES256 JWT for the App Store Connect API.
pub fn make_jwt(c: &Credentials, now_unix: u64) -> Result<String, AscError> {
    let key =
        SigningKey::from_pkcs8_pem(&c.private_key_pem).map_err(|e| AscError::Key(e.to_string()))?;
    let header = json!({"alg": "ES256", "kid": c.key_id, "typ": "JWT"});
    let claims = json!({"iss": c.issuer_id, "iat": now_unix, "exp": now_unix + TOKEN_LIFETIME_SECS, "aud": "appstoreconnect-v1"});
    let signing_input = format!("{}.{}", b64(&header), b64(&claims));
    let sig: Signature = key.sign(signing_input.as_bytes());
    Ok(format!(
        "{signing_input}.{}",
        URL_SAFE_NO_PAD.encode(sig.to_bytes())
    ))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub bundle_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resource {
    pub id: String,
    pub name: String,
    /// Certificate/profile body (base64 as returned by Apple), when present.
    pub content: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadState {
    Uploading,
    Processing,
    Complete,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Progress {
    Created { upload_id: String },
    Part { done: usize, total: usize },
    Committed,
    State(String),
}

pub struct AscClient {
    http: reqwest::Client,
    base: String,
    creds: Credentials,
    allow_http: bool,
    poll_every: Duration,
}

impl AscClient {
    pub fn new(creds: Credentials) -> Result<Self, AscError> {
        validate_credentials(&creds).map_err(AscError::Key)?;
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .map_err(|e| AscError::Network(e.to_string()))?;
        Ok(Self {
            http,
            base: API_BASE.to_owned(),
            creds,
            allow_http: false,
            poll_every: Duration::from_secs(10),
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test(creds: Credentials, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        Self {
            http,
            base,
            creds,
            allow_http: true,
            poll_every: Duration::from_millis(5),
        }
    }

    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<Value, AscError> {
        let token = make_jwt(&self.creds, now())?;
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .bearer_auth(token)
            .query(query);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| AscError::Network(e.without_url().to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| AscError::Network(e.without_url().to_string()))?;
        if status.is_success() {
            return if text.trim().is_empty() {
                Ok(Value::Null)
            } else {
                serde_json::from_str(&text).map_err(|e| AscError::Shape(e.to_string()))
            };
        }
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let e = &v["errors"][0];
        let s = |k: &str| {
            e[k].as_str()
                .unwrap_or("")
                .chars()
                .take(300)
                .collect::<String>()
        };
        Err(AscError::Api {
            status: status.as_u16(),
            code: s("code"),
            title: s("title"),
            detail: s("detail"),
        })
    }

    /// Cheap credential check.
    pub async fn ping(&self) -> Result<(), AscError> {
        self.call(reqwest::Method::GET, "/v1/apps", &[("limit", "1")], None)
            .await
            .map(|_| ())
    }

    pub async fn find_app(&self, bundle_id: &str) -> Result<Option<AppInfo>, AscError> {
        let v = self
            .call(
                reqwest::Method::GET,
                "/v1/apps",
                &[("filter[bundleId]", bundle_id), ("limit", "1")],
                None,
            )
            .await?;
        Ok(v["data"]
            .as_array()
            .and_then(|a| a.first())
            .map(|d| AppInfo {
                id: d["id"].as_str().unwrap_or_default().to_owned(),
                name: d["attributes"]["name"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
                bundle_id: d["attributes"]["bundleId"]
                    .as_str()
                    .unwrap_or(bundle_id)
                    .to_owned(),
            }))
    }

    pub async fn find_bundle_id(&self, identifier: &str) -> Result<Option<Resource>, AscError> {
        let v = self
            .call(
                reqwest::Method::GET,
                "/v1/bundleIds",
                &[
                    ("filter[identifier]", identifier),
                    ("filter[platform]", "IOS"),
                ],
                None,
            )
            .await?;
        Ok(first_resource(&v, |d| {
            d["attributes"]["identifier"].as_str() == Some(identifier)
        }))
    }

    pub async fn create_bundle_id(
        &self,
        identifier: &str,
        name: &str,
    ) -> Result<Resource, AscError> {
        let body = json!({"data": {"type": "bundleIds", "attributes": {"name": name, "platform": "IOS", "identifier": identifier}}});
        resource(
            &self
                .call(reqwest::Method::POST, "/v1/bundleIds", &[], Some(body))
                .await?,
        )
    }

    pub async fn create_distribution_certificate(
        &self,
        csr_pem: &str,
    ) -> Result<Resource, AscError> {
        let body = json!({"data": {"type": "certificates", "attributes": {"csrContent": csr_pem, "certificateType": "IOS_DISTRIBUTION"}}});
        resource(
            &self
                .call(reqwest::Method::POST, "/v1/certificates", &[], Some(body))
                .await?,
        )
    }

    /// An active App Store profile with exactly this name (re-use instead of piling up new ones).
    pub async fn find_app_store_profile(&self, name: &str) -> Result<Option<Resource>, AscError> {
        let v = self
            .call(
                reqwest::Method::GET,
                "/v1/profiles",
                &[
                    ("filter[name]", name),
                    ("filter[profileType]", "IOS_APP_STORE"),
                    ("filter[profileState]", "ACTIVE"),
                    ("limit", "10"),
                ],
                None,
            )
            .await?;
        Ok(resources(&v, "profileContent")
            .into_iter()
            .find(|r| r.name == name))
    }

    pub async fn create_app_store_profile(
        &self,
        name: &str,
        bundle_id_resource: &str,
        certificate_ids: &[String],
    ) -> Result<Resource, AscError> {
        let certs: Vec<Value> = certificate_ids
            .iter()
            .map(|id| json!({"type": "certificates", "id": id}))
            .collect();
        let body = json!({"data": {"type": "profiles",
            "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
            "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle_id_resource}}, "certificates": {"data": certs}}}});
        let v = self
            .call(reqwest::Method::POST, "/v1/profiles", &[], Some(body))
            .await?;
        let mut r = resource(&v)?;
        r.content = v["data"]["attributes"]["profileContent"]
            .as_str()
            .map(str::to_owned);
        Ok(r)
    }

    /// Decode base64 `profileContent`/`certificateContent` returned by Apple.
    pub fn decode_content(b64_text: &str) -> Result<Vec<u8>, AscError> {
        STANDARD
            .decode(b64_text.trim())
            .map_err(|e| AscError::Shape(e.to_string()))
    }

    /// Upload a signed `.ipa` as a new build (Build Uploads flow).
    pub async fn upload_ipa(
        &self,
        ipa: &Path,
        app_id: &str,
        short_version: &str,
        build_version: &str,
        wait_secs: u64,
        mut progress: impl FnMut(Progress),
    ) -> Result<UploadState, AscError> {
        let (size, sha) = file_size_and_sha256(ipa)?;
        if size == 0 {
            return Err(AscError::Io("IPA boş".into()));
        }
        let file_name = ipa
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("app.ipa")
            .to_owned();

        let up = self
            .call(reqwest::Method::POST, "/v1/buildUploads", &[], Some(json!({"data": {"type": "buildUploads",
                "attributes": {"cfBundleShortVersionString": short_version, "cfBundleVersion": build_version, "platform": "IOS"},
                "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})))
            .await?;
        let upload_id = up["data"]["id"]
            .as_str()
            .ok_or_else(|| AscError::Shape("buildUploads id yok".into()))?
            .to_owned();
        progress(Progress::Created {
            upload_id: upload_id.clone(),
        });

        let file = self
            .call(reqwest::Method::POST, "/v1/buildUploadFiles", &[], Some(json!({"data": {"type": "buildUploadFiles",
                "attributes": {"fileName": file_name, "fileSize": size, "uti": "com.apple.ipa", "assetType": "ASSET"},
                "relationships": {"buildUpload": {"data": {"type": "buildUploads", "id": upload_id}}}}})))
            .await?;
        let file_id = file["data"]["id"]
            .as_str()
            .ok_or_else(|| AscError::Shape("buildUploadFiles id yok".into()))?
            .to_owned();
        let ops = file["data"]["attributes"]["uploadOperations"]
            .as_array()
            .ok_or_else(|| AscError::Shape("uploadOperations yok".into()))?
            .clone();
        if ops.is_empty() || ops.len() > MAX_PARTS {
            return Err(AscError::Upload(format!(
                "{} parça isteği makul değil",
                ops.len()
            )));
        }

        // Presigned URLs: plain client, no JWT.
        let part_client = reqwest::Client::builder()
            .timeout(PART_TIMEOUT)
            .build()
            .map_err(|e| AscError::Network(e.to_string()))?;
        for (i, op) in ops.iter().enumerate() {
            let (url, offset, length) = self.check_operation(op, size)?;
            let bytes = read_slice(ipa, offset, length)?;
            let mut req = part_client.put(url).body(bytes);
            for h in op["requestHeaders"].as_array().into_iter().flatten() {
                let (n, v) = (
                    h["name"].as_str().unwrap_or(""),
                    h["value"].as_str().unwrap_or(""),
                );
                if n.is_empty()
                    || n.eq_ignore_ascii_case("content-length")
                    || n.eq_ignore_ascii_case("host")
                    || n.eq_ignore_ascii_case("authorization")
                {
                    continue;
                }
                req = req.header(n, v);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| AscError::Network(e.without_url().to_string()))?;
            if !resp.status().is_success() {
                return Err(AscError::Upload(format!(
                    "parça {} reddedildi (HTTP {})",
                    i + 1,
                    resp.status().as_u16()
                )));
            }
            progress(Progress::Part {
                done: i + 1,
                total: ops.len(),
            });
        }

        self.call(
            reqwest::Method::PATCH,
            &format!("/v1/buildUploadFiles/{file_id}"),
            &[],
            Some(json!({"data": {"type": "buildUploadFiles", "id": file_id,
                "attributes": {"uploaded": true, "sourceFileChecksums": {"file": {"hash": sha, "algorithm": "SHA_256"}}}}})),
        )
        .await?;
        progress(Progress::Committed);

        let deadline = std::time::Instant::now() + Duration::from_secs(wait_secs);
        loop {
            let st = self.upload_state(&upload_id).await?;
            progress(Progress::State(format!("{st:?}")));
            if matches!(st, UploadState::Complete | UploadState::Failed(_)) {
                return Ok(st);
            }
            if std::time::Instant::now() >= deadline {
                return Err(AscError::Timeout(wait_secs));
            }
            tokio::time::sleep(self.poll_every).await;
        }
    }

    pub async fn upload_state(&self, upload_id: &str) -> Result<UploadState, AscError> {
        let v = self
            .call(
                reqwest::Method::GET,
                &format!("/v1/buildUploads/{upload_id}"),
                &[],
                None,
            )
            .await?;
        let st = &v["data"]["attributes"]["state"];
        Ok(match st["state"].as_str().unwrap_or("") {
            "COMPLETE" => UploadState::Complete,
            "FAILED" => {
                let msg: Vec<String> = st["errors"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|e| {
                        format!(
                            "{} {}",
                            e["code"].as_str().unwrap_or(""),
                            e["description"].as_str().unwrap_or("")
                        )
                    })
                    .collect();
                UploadState::Failed(msg.join("; "))
            }
            "PROCESSING" => UploadState::Processing,
            _ => UploadState::Uploading,
        })
    }

    /// Validate one `uploadOperations` entry: https only (http allowed only in tests), PUT only,
    /// and the byte range must lie inside the file.
    fn check_operation(&self, op: &Value, file_size: u64) -> Result<(String, u64, u64), AscError> {
        let url = op["url"]
            .as_str()
            .ok_or_else(|| AscError::Upload("işlemde url yok".into()))?;
        let https = url.starts_with("https://");
        if !https && !(self.allow_http && url.starts_with("http://127.0.0.1")) {
            return Err(AscError::Upload(
                "Apple https olmayan bir yükleme adresi verdi; reddedildi.".into(),
            ));
        }
        if !op["method"]
            .as_str()
            .unwrap_or("")
            .eq_ignore_ascii_case("PUT")
        {
            return Err(AscError::Upload(
                "Beklenmeyen yükleme yöntemi (PUT değil).".into(),
            ));
        }
        let (offset, length) = (
            op["offset"].as_u64().unwrap_or(u64::MAX),
            op["length"].as_u64().unwrap_or(0),
        );
        if length == 0 || offset.checked_add(length).is_none_or(|end| end > file_size) {
            return Err(AscError::Upload(
                "Parça aralığı dosya boyutunu aşıyor.".into(),
            ));
        }
        Ok((url.to_owned(), offset, length))
    }
}

fn resource(v: &Value) -> Result<Resource, AscError> {
    let d = &v["data"];
    Ok(Resource {
        id: d["id"]
            .as_str()
            .ok_or_else(|| AscError::Shape("id yok".into()))?
            .to_owned(),
        name: d["attributes"]["name"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        content: d["attributes"]["certificateContent"]
            .as_str()
            .map(str::to_owned),
    })
}

fn first_resource(v: &Value, pred: impl Fn(&Value) -> bool) -> Option<Resource> {
    v["data"]
        .as_array()?
        .iter()
        .find(|d| pred(d))
        .map(|d| Resource {
            id: d["id"].as_str().unwrap_or_default().to_owned(),
            name: d["attributes"]["name"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            content: None,
        })
}

fn resources(v: &Value, content_key: &str) -> Vec<Resource> {
    v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|d| Resource {
            id: d["id"].as_str().unwrap_or_default().to_owned(),
            name: d["attributes"]["name"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            content: d["attributes"][content_key].as_str().map(str::to_owned),
        })
        .collect()
}

fn file_size_and_sha256(path: &Path) -> Result<(u64, String), AscError> {
    let mut f = std::fs::File::open(path).map_err(|e| AscError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(|e| AscError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((
        total,
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    ))
}

fn read_slice(path: &Path, offset: u64, length: u64) -> Result<Vec<u8>, AscError> {
    let mut f = std::fs::File::open(path).map_err(|e| AscError::Io(e.to_string()))?;
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| AscError::Io(e.to_string()))?;
    let mut buf =
        vec![0u8; usize::try_from(length).map_err(|_| AscError::Io("parça çok büyük".into()))?];
    f.read_exact(&mut buf)
        .map_err(|e| AscError::Io(e.to_string()))?;
    Ok(buf)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    use p256::ecdsa::VerifyingKey;
    use p256::pkcs8::{EncodePrivateKey, LineEnding};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[allow(non_snake_case)]
    pub(crate) fn Credentials_for_tests() -> Credentials {
        test_creds()
    }

    fn test_creds() -> Credentials {
        // Deterministic throw-away scalar; generated at runtime so no key material sits in the repo.
        let key = SigningKey::from_slice(&[7u8; 32]).unwrap();
        Credentials {
            issuer_id: "69a6de70-0000-0000-0000-000000000000".into(),
            key_id: "ABC123DEFG".into(),
            private_key_pem: key.to_pkcs8_pem(LineEnding::LF).unwrap().to_string(),
        }
    }

    #[derive(Debug, Clone)]
    pub(crate) struct Req {
        pub(crate) method: String,
        pub(crate) path: String,
        pub(crate) auth: bool,
        pub(crate) body: Vec<u8>,
        pub(crate) headers: Vec<(String, String)>,
    }

    pub(crate) type Handler = Box<dyn Fn(&Req) -> (u16, String) + Send + Sync>;

    /// Minimal HTTP/1.1 mock: one request per connection, `Connection: close`.
    pub(crate) async fn serve(handler: Handler) -> (String, Arc<Mutex<Vec<Req>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let log = Arc::new(Mutex::new(Vec::new()));
        let (log2, handler) = (log.clone(), Arc::new(handler));
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else {
                    return;
                };
                let (log, handler) = (log2.clone(), handler.clone());
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 8192];
                    let head_end = loop {
                        let n = s.read(&mut tmp).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break p + 4;
                        }
                    };
                    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                    let mut lines = head.lines();
                    let mut first = lines.next().unwrap_or("").split(' ');
                    let (method, path) = (
                        first.next().unwrap_or("").to_owned(),
                        first.next().unwrap_or("").to_owned(),
                    );
                    let headers: Vec<(String, String)> = lines
                        .filter_map(|l| l.split_once(": "))
                        .map(|(a, b)| (a.to_lowercase(), b.to_owned()))
                        .collect();
                    let len: usize = headers
                        .iter()
                        .find(|(k, _)| k == "content-length")
                        .and_then(|(_, v)| v.parse().ok())
                        .unwrap_or(0);
                    while buf.len() < head_end + len {
                        let n = s.read(&mut tmp).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                    }
                    let req = Req {
                        method,
                        path,
                        auth: headers.iter().any(|(k, _)| k == "authorization"),
                        body: buf[head_end..].to_vec(),
                        headers,
                    };
                    log.lock().unwrap().push(req.clone());
                    let (status, body) = handler(&req);
                    let resp = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = s.write_all(resp.as_bytes()).await;
                });
            }
        });
        (base, log)
    }

    #[test]
    fn jwt_has_es256_header_short_lifetime_and_valid_signature() {
        let c = test_creds();
        let jwt = make_jwt(&c, 1_700_000_000).unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        let dec =
            |s: &str| serde_json::from_slice::<Value>(&URL_SAFE_NO_PAD.decode(s).unwrap()).unwrap();
        let (h, p) = (dec(parts[0]), dec(parts[1]));
        assert_eq!(
            (h["alg"].as_str(), h["kid"].as_str(), h["typ"].as_str()),
            (Some("ES256"), Some("ABC123DEFG"), Some("JWT"))
        );
        assert_eq!(p["aud"], "appstoreconnect-v1");
        assert_eq!(p["iss"], c.issuer_id);
        assert!(p["exp"].as_u64().unwrap() - p["iat"].as_u64().unwrap() <= 1200);
        let sig = Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap()).unwrap();
        let vk = VerifyingKey::from(&SigningKey::from_pkcs8_pem(&c.private_key_pem).unwrap());
        vk.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &sig)
            .unwrap();
    }

    #[test]
    fn credential_validation_and_debug_hide_the_key() {
        let c = test_creds();
        assert!(validate_credentials(&c).is_ok());
        assert!(!format!("{c:?}").contains("BEGIN"));
        let mut bad = c.clone();
        bad.private_key_pem = "nope".into();
        assert!(validate_credentials(&bad).is_err());
        bad = c.clone();
        bad.key_id = "x y".into();
        assert!(validate_credentials(&bad).is_err());
    }

    #[tokio::test]
    async fn maps_api_errors_without_leaking_the_token() {
        let (base, _) = serve(Box::new(|_| (401, r#"{"errors":[{"code":"NOT_AUTHORIZED","title":"Authentication credentials are missing or invalid.","detail":"Provide a properly configured and signed bearer token."}]}"#.into()))).await;
        let err = AscClient::for_test(test_creds(), base)
            .ping()
            .await
            .unwrap_err();
        match &err {
            AscError::Api {
                status: 401, code, ..
            } => assert_eq!(code, "NOT_AUTHORIZED"),
            other => panic!("{other:?}"),
        }
        assert!(!err.to_string().contains("eyJ"));
    }

    #[tokio::test]
    async fn find_app_and_bundle_id_use_filters() {
        let (base, log) = serve(Box::new(|r| {
            if r.path.starts_with("/v1/apps") {
                (200, r#"{"data":[{"id":"111","attributes":{"name":"Zeta","bundleId":"com.zeta.app"}}]}"#.into())
            } else {
                (200, r#"{"data":[{"id":"B1","attributes":{"name":"Zeta","identifier":"com.zeta.app"}}]}"#.into())
            }
        }))
        .await;
        let c = AscClient::for_test(test_creds(), base);
        assert_eq!(c.find_app("com.zeta.app").await.unwrap().unwrap().id, "111");
        assert_eq!(
            c.find_bundle_id("com.zeta.app").await.unwrap().unwrap().id,
            "B1"
        );
        assert_eq!(c.find_bundle_id("com.other").await.unwrap(), None);
        let l = log.lock().unwrap();
        assert!(l[0].path.contains("filter%5BbundleId%5D=com.zeta.app") && l[0].auth);
    }

    type Parts = Arc<Mutex<Vec<Vec<u8>>>>;

    fn upload_fixture(ops: String) -> (Handler, Parts, Arc<Mutex<u32>>) {
        let parts = Arc::new(Mutex::new(Vec::new()));
        let polls = Arc::new(Mutex::new(0u32));
        let (p2, polls2) = (parts.clone(), polls.clone());
        let h: Handler = Box::new(move |r| match (r.method.as_str(), r.path.as_str()) {
            ("POST", "/v1/buildUploads") => (201, r#"{"data":{"id":"U1"}}"#.into()),
            ("POST", "/v1/buildUploadFiles") => (
                201,
                format!(r#"{{"data":{{"id":"F1","attributes":{{"uploadOperations":{ops}}}}}}}"#),
            ),
            ("PUT", p) if p.starts_with("/part") => {
                assert!(!r.auth, "JWT must never reach upload URLs");
                assert!(r
                    .headers
                    .iter()
                    .any(|(k, v)| k == "content-type" && v == "application/octet-stream"));
                p2.lock().unwrap().push(r.body.clone());
                (200, String::new())
            }
            ("PATCH", "/v1/buildUploadFiles/F1") => {
                let b: Value = serde_json::from_slice(&r.body).unwrap();
                assert_eq!(b["data"]["attributes"]["uploaded"], true);
                assert_eq!(
                    b["data"]["attributes"]["sourceFileChecksums"]["file"]["algorithm"],
                    "SHA_256"
                );
                (200, r#"{"data":{"id":"F1"}}"#.into())
            }
            ("GET", "/v1/buildUploads/U1") => {
                let mut n = polls2.lock().unwrap();
                *n += 1;
                let state = if *n < 2 { "PROCESSING" } else { "COMPLETE" };
                (
                    200,
                    format!(r#"{{"data":{{"attributes":{{"state":{{"state":"{state}"}}}}}}}}"#),
                )
            }
            other => panic!("beklenmeyen istek {other:?}"),
        });
        (h, parts, polls)
    }

    #[tokio::test]
    async fn uploads_in_parts_commits_with_checksum_and_polls_to_complete() {
        let dir = tempfile::tempdir().unwrap();
        let ipa = dir.path().join("App.ipa");
        std::fs::write(&ipa, b"0123456789").unwrap();
        // Handler needs the final base URL inside the operations, so bind first via a shared cell.
        let cell = Arc::new(Mutex::new(String::new()));
        let cell2 = cell.clone();
        let (inner, parts, _polls) = upload_fixture("__OPS__".into());
        let handler: Handler = Box::new(move |r| {
            let (st, body) = inner(r);
            let base = cell2.lock().unwrap().clone();
            let ops = format!(
                r#"[{{"method":"PUT","url":"{base}/part1","offset":0,"length":4,"requestHeaders":[{{"name":"Content-Type","value":"application/octet-stream"}},{{"name":"Content-Length","value":"999"}}]}},{{"method":"PUT","url":"{base}/part2","offset":4,"length":6,"requestHeaders":[{{"name":"Content-Type","value":"application/octet-stream"}}]}}]"#
            );
            (
                st,
                body.replace("\"__OPS__\"", &ops).replace("__OPS__", &ops),
            )
        });
        let (base, _log) = serve(handler).await;
        *cell.lock().unwrap() = base.clone();
        let client = AscClient::for_test(test_creds(), base);
        let mut events = Vec::new();
        let st = client
            .upload_ipa(&ipa, "111", "1.0", "7", 5, |p| events.push(p))
            .await
            .unwrap();
        assert_eq!(st, UploadState::Complete);
        assert_eq!(parts.lock().unwrap().concat(), b"0123456789");
        assert!(
            events.contains(&Progress::Part { done: 2, total: 2 })
                && events.contains(&Progress::Committed)
        );
    }

    #[tokio::test]
    async fn refuses_http_urls_foreign_methods_and_out_of_range_parts() {
        let c = AscClient::new(test_creds()).unwrap();
        let ok = json!({"method":"PUT","url":"https://example.apple.com/x","offset":0,"length":5});
        assert!(c.check_operation(&ok, 10).is_ok());
        for bad in [
            json!({"method":"PUT","url":"http://example.apple.com/x","offset":0,"length":5}),
            json!({"method":"PUT","url":"http://127.0.0.1:1/x","offset":0,"length":5}),
            json!({"method":"POST","url":"https://example.apple.com/x","offset":0,"length":5}),
            json!({"method":"PUT","url":"https://example.apple.com/x","offset":8,"length":5}),
            json!({"method":"PUT","url":"https://example.apple.com/x","offset":0,"length":0}),
            json!({"method":"PUT","url":"https://example.apple.com/x","offset":18446744073709551615u64,"length":2}),
        ] {
            assert!(c.check_operation(&bad, 10).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn failed_state_carries_apple_error_text() {
        let (base, _) = serve(Box::new(|_| (200, r#"{"data":{"attributes":{"state":{"state":"FAILED","errors":[{"code":"90022","description":"Missing icon"}]}}}}"#.into()))).await;
        let st = AscClient::for_test(test_creds(), base)
            .upload_state("U1")
            .await
            .unwrap();
        assert_eq!(st, UploadState::Failed("90022 Missing icon".into()));
    }

    #[tokio::test]
    async fn creates_profile_with_certificate_relationship() {
        let (base, log) = serve(Box::new(|_| {
            (
                201,
                r#"{"data":{"id":"P1","attributes":{"name":"Zeta","profileContent":"UFJPRg=="}}}"#
                    .into(),
            )
        }))
        .await;
        let r = AscClient::for_test(test_creds(), base)
            .create_app_store_profile("Zeta", "B1", &["C1".into()])
            .await
            .unwrap();
        assert_eq!(
            AscClient::decode_content(r.content.as_deref().unwrap()).unwrap(),
            b"PROF"
        );
        let body: Value = serde_json::from_slice(&log.lock().unwrap()[0].body).unwrap();
        assert_eq!(body["data"]["attributes"]["profileType"], "IOS_APP_STORE");
        assert_eq!(
            body["data"]["relationships"]["certificates"]["data"][0]["id"],
            "C1"
        );
    }
}
