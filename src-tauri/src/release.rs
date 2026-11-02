//! Release orchestration (no Tauri): distribution certificate, App Store profile, signing,
//! and the pinned `rcodesign` download. Thin Tauri commands in `lib.rs` call into this.
//!
//! Rules: nothing is revoked or deleted on Apple's side; private keys never leave the app data
//! dir (0700) and the `.p12` password lives in the OS keyring; temporary secrets (password file,
//! extracted app) are removed even when a step fails.
//!
//! Status: unit-tested with fake tools and a mock server. NOT_VERIFIED against a real Apple
//! account or a real `rcodesign` signature.

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::appstore::{AscClient, AscError};
use crate::ipa_pack;
use crate::runner::{self, CancelToken, Spec};
use crate::signing::{self, ProfileInfo};

#[derive(Debug, thiserror::Error)]
pub enum ReleaseError {
    #[error(transparent)]
    Asc(#[from] AscError),
    #[error(transparent)]
    Pack(#[from] ipa_pack::RepackError),
    #[error("Araç hatası: {0}")]
    Tool(String),
    #[error("Dosya hatası: {0}")]
    Io(String),
    #[error("İndirme reddedildi: {0}")]
    Download(String),
    #[error("{0}")]
    Invalid(String),
}

impl From<std::io::Error> for ReleaseError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertInfo {
    pub certificate_id: String,
    pub p12_path: PathBuf,
    pub created: bool,
}

/// Run a spec to completion; return the tail of its output on failure.
async fn run_tool(spec: Spec, label: &'static str) -> Result<(), ReleaseError> {
    let joined = tokio::task::spawn_blocking(move || {
        let mut tail: Vec<String> = Vec::new();
        let info = runner::run(&spec, &CancelToken::new(), |_, line| {
            tail.push(line);
            if tail.len() > 20 {
                tail.remove(0);
            }
        });
        (info, tail)
    })
    .await
    .map_err(|e| ReleaseError::Tool(e.to_string()))?;
    let (info, tail) = joined;
    let info = info.map_err(|e| ReleaseError::Tool(format!("{label} başlatılamadı: {e}")))?;
    if info.timed_out {
        return Err(ReleaseError::Tool(format!("{label} zaman aşımına uğradı")));
    }
    if info.code != Some(0) {
        return Err(ReleaseError::Tool(format!(
            "{label} başarısız (kod {:?}): {}",
            info.code,
            tail.join(" | ")
        )));
    }
    Ok(())
}

#[cfg(unix)]
fn private_dir(p: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(p)?;
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700))
}
#[cfg(not(unix))]
fn private_dir(p: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(p)
}

#[cfg(unix)]
fn write_secret(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(bytes)
}
#[cfg(not(unix))]
fn write_secret(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}

/// `n` random bytes as hex (unix `/dev/urandom`; this app targets Linux).
pub fn random_hex(n: usize) -> Result<String, ReleaseError> {
    let mut buf = vec![0u8; n];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| ReleaseError::Io(format!("rastgele veri alınamadı: {e}")))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn bundle_dir(data_dir: &Path, bundle_id: &str) -> Result<PathBuf, ReleaseError> {
    crate::xtool::validate_bundle_id(bundle_id).map_err(ReleaseError::Invalid)?;
    Ok(data_dir.join("signing").join(bundle_id))
}

/// Re-use the locally stored distribution `.p12`, or create key + CSR, ask Apple for the
/// certificate and bundle everything into a `.p12`. Existing certificates are never revoked.
pub async fn ensure_certificate(
    client: &AscClient,
    openssl: &Path,
    data_dir: &Path,
    bundle_id: &str,
    common_name: &str,
    email: &str,
    p12_password: &str,
) -> Result<CertInfo, ReleaseError> {
    let dir = bundle_dir(data_dir, bundle_id)?;
    private_dir(&dir)?;
    let (p12, id_file) = (dir.join("distribution.p12"), dir.join("certificate_id.txt"));
    if p12.is_file() && id_file.is_file() {
        let certificate_id = std::fs::read_to_string(&id_file)?.trim().to_owned();
        return Ok(CertInfo {
            certificate_id,
            p12_path: p12,
            created: false,
        });
    }
    let (key, csr, cer, pem, pw) = (
        dir.join("distribution.key"),
        dir.join("request.csr"),
        dir.join("distribution.cer"),
        dir.join("distribution.pem"),
        dir.join("p12.pw"),
    );
    let result = async {
        run_tool(
            signing::csr_spec(openssl, &dir, &key, &csr, common_name, email)
                .map_err(ReleaseError::Invalid)?,
            "openssl req",
        )
        .await?;
        let csr_text = std::fs::read_to_string(&csr)?;
        let cert = client.create_distribution_certificate(&csr_text).await?;
        let der = AscClient::decode_content(
            cert.content
                .as_deref()
                .ok_or_else(|| AscError::Shape("certificateContent yok".into()))?,
        )?;
        std::fs::write(&cer, der)?;
        run_tool(
            signing::der_to_pem_spec(openssl, &dir, &cer, &pem).map_err(ReleaseError::Invalid)?,
            "openssl x509",
        )
        .await?;
        write_secret(&pw, p12_password.as_bytes())?;
        run_tool(
            signing::p12_spec(openssl, &dir, &key, &pem, &p12, &pw)
                .map_err(ReleaseError::Invalid)?,
            "openssl pkcs12",
        )
        .await?;
        std::fs::write(&id_file, &cert.id)?;
        Ok::<_, ReleaseError>(cert.id)
    }
    .await;
    // The private key and the password file never outlive this call (the `.p12` holds the key).
    for f in [&key, &pw, &pem, &cer, &csr] {
        let _ = std::fs::remove_file(f);
    }
    match result {
        Ok(certificate_id) => Ok(CertInfo {
            certificate_id,
            p12_path: p12,
            created: true,
        }),
        Err(e) => {
            let _ = std::fs::remove_file(&p12);
            Err(e)
        }
    }
}

/// Active App Store profile for `bundle_id` (re-used by name), creating the bundle id and the
/// profile only when missing. Returns the raw `.mobileprovision` bytes.
pub async fn ensure_profile(
    client: &AscClient,
    bundle_id: &str,
    app_name: &str,
    certificate_id: &str,
) -> Result<(Vec<u8>, ProfileInfo), ReleaseError> {
    let name = format!("Open iOS Studio {bundle_id}");
    let content = match client.find_app_store_profile(&name).await? {
        Some(r) if r.content.is_some() => r.content,
        _ => {
            let bundle = match client.find_bundle_id(bundle_id).await? {
                Some(b) => b,
                None => client.create_bundle_id(bundle_id, app_name).await?,
            };
            client
                .create_app_store_profile(&name, &bundle.id, &[certificate_id.to_owned()])
                .await?
                .content
        }
    };
    let bytes = AscClient::decode_content(
        &content.ok_or_else(|| AscError::Shape("profileContent yok".into()))?,
    )?;
    let info = signing::parse_profile(&bytes).map_err(ReleaseError::Invalid)?;
    let issues = signing::check_profile_for_app_store(&info, bundle_id);
    if !issues.is_empty() {
        return Err(ReleaseError::Invalid(issues.join(" ")));
    }
    Ok((bytes, info))
}

/// Sign `ipa_in` into `ipa_out`: extract, embed the profile, sign the `.app` with rcodesign,
/// zip again. The password file and the extracted tree are removed in every case.
pub async fn sign_ipa(
    rcodesign: &Path,
    data_dir: &Path,
    ipa_in: &Path,
    ipa_out: &Path,
    profile_bytes: &[u8],
    p12: &Path,
    p12_password: &str,
) -> Result<(), ReleaseError> {
    let profile = signing::parse_profile(profile_bytes).map_err(ReleaseError::Invalid)?;
    let work = data_dir.join("tmp").join(random_hex(8)?);
    private_dir(&work)?;
    let result = async {
        let app = ipa_pack::extract(ipa_in, &work)?;
        std::fs::write(app.join("embedded.mobileprovision"), profile_bytes)?;
        let (ents, pw) = (work.join("entitlements.xml"), work.join("p12.pw"));
        std::fs::write(
            &ents,
            signing::entitlements_xml(&profile).map_err(ReleaseError::Invalid)?,
        )?;
        write_secret(&pw, p12_password.as_bytes())?;
        run_tool(
            signing::rcodesign_sign_spec(rcodesign, &work, &app, p12, &pw, &ents)
                .map_err(ReleaseError::Invalid)?,
            "rcodesign",
        )
        .await?;
        let _ = std::fs::remove_file(&pw);
        ipa_pack::zip_payload(&work, ipa_out)?;
        Ok::<_, ReleaseError>(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&work);
    result
}

/// Find `rcodesign` on PATH, else the pinned copy in the app data dir, else download it.
pub async fn ensure_rcodesign(data_dir: &Path, path_var: &OsStr) -> Result<PathBuf, ReleaseError> {
    if let Some(p) = crate::xtool::find_in_path("rcodesign", path_var) {
        return Ok(p);
    }
    let dest = signing::rcodesign_install_path(data_dir);
    if dest.is_file() {
        return Ok(dest);
    }
    download_and_install(
        signing::RCODESIGN_URL,
        signing::RCODESIGN_SHA256,
        &dest,
        signing::is_allowed_download,
    )
    .await?;
    Ok(dest)
}

const MAX_DOWNLOAD: usize = 150 * 1024 * 1024;

pub async fn download_and_install(
    url: &str,
    sha256: &str,
    dest: &Path,
    allow: fn(&str) -> bool,
) -> Result<(), ReleaseError> {
    if !allow(url) {
        return Err(ReleaseError::Download("adres izinli listede değil".into()));
    }
    let policy = reqwest::redirect::Policy::custom(move |a| {
        if a.previous().len() < 5 && allow(a.url().as_str()) {
            a.follow()
        } else {
            a.error("yönlendirme izinli listede değil")
        }
    });
    let client = reqwest::Client::builder()
        .redirect(policy)
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| ReleaseError::Download(e.to_string()))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| ReleaseError::Download(e.without_url().to_string()))?;
    if !resp.status().is_success() {
        return Err(ReleaseError::Download(format!(
            "HTTP {}",
            resp.status().as_u16()
        )));
    }
    if resp
        .content_length()
        .is_some_and(|n| n as usize > MAX_DOWNLOAD)
    {
        return Err(ReleaseError::Download("dosya çok büyük".into()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| ReleaseError::Download(e.without_url().to_string()))?;
    if bytes.len() > MAX_DOWNLOAD {
        return Err(ReleaseError::Download("dosya çok büyük".into()));
    }
    install_from_tarball(&bytes, sha256, dest)
}

/// Verify the SHA-256, then pull the single `rcodesign` file out of the tarball by name
/// (nothing else is extracted, so archive paths cannot escape).
pub fn install_from_tarball(bytes: &[u8], sha256: &str, dest: &Path) -> Result<(), ReleaseError> {
    signing::verify_sha256(bytes, sha256).map_err(ReleaseError::Download)?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    for entry in archive.entries()? {
        let mut entry = entry?;
        let is_bin = entry.header().entry_type().is_file()
            && entry.path()?.file_name().is_some_and(|n| n == "rcodesign");
        if !is_bin {
            continue;
        }
        let mut data = Vec::new();
        entry
            .by_ref()
            .take(MAX_DOWNLOAD as u64)
            .read_to_end(&mut data)?;
        let parent = dest
            .parent()
            .ok_or_else(|| ReleaseError::Io("hedef klasör yok".into()))?;
        private_dir(parent)?;
        let tmp = dest.with_extension("part");
        std::fs::write(&tmp, &data)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        }
        std::fs::rename(&tmp, dest)?;
        return Ok(());
    }
    Err(ReleaseError::Download(
        "arşivde rcodesign bulunamadı".into(),
    ))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::appstore::tests::{serve, Credentials_for_tests};
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    const FAKE_OPENSSL: &str = r#"sub=$1; shift
while [ $# -gt 0 ]; do case "$1" in -keyout) key=$2;; -out) out=$2;; -in) inp=$2;; -passout) pw=$2;; esac; shift; done
case $sub in
  req) echo KEY > "$key"; echo CSR > "$out";;
  x509) cp "$inp" "$out";;
  pkcs12) test -f "${pw#file:}" || exit 3; echo P12 > "$out";;
esac"#;

    #[tokio::test]
    async fn certificate_flow_builds_p12_cleans_secrets_and_is_reused() {
        let tools = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let openssl = script(tools.path(), "openssl", FAKE_OPENSSL);
        let (base, log) = serve(Box::new(|r| {
            assert!(r.path.starts_with("/v1/certificates"));
            (
                201,
                r#"{"data":{"id":"CERT1","attributes":{"certificateContent":"Q0VS"}}}"#.into(),
            )
        }))
        .await;
        let client = AscClient::for_test(Credentials_for_tests(), base);
        let c = ensure_certificate(
            &client,
            &openssl,
            data.path(),
            "com.zeta.app",
            "Open iOS Studio",
            "a@b.co",
            "pw-secret",
        )
        .await
        .unwrap();
        assert!(c.created && c.certificate_id == "CERT1" && c.p12_path.is_file());
        let dir = c.p12_path.parent().unwrap();
        for gone in [
            "distribution.key",
            "p12.pw",
            "distribution.pem",
            "request.csr",
        ] {
            assert!(!dir.join(gone).exists(), "{gone} should be removed");
        }
        assert_eq!(
            std::fs::metadata(dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let again = ensure_certificate(
            &client,
            &openssl,
            data.path(),
            "com.zeta.app",
            "x",
            "a@b.co",
            "other",
        )
        .await
        .unwrap();
        assert!(!again.created && again.certificate_id == "CERT1");
        assert_eq!(log.lock().unwrap().len(), 1, "no second API call");
    }

    #[tokio::test]
    async fn certificate_failure_leaves_no_secrets_behind() {
        let tools = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let openssl = script(tools.path(), "openssl", FAKE_OPENSSL);
        let (base, _) = serve(Box::new(|_| {
            (
                409,
                r#"{"errors":[{"code":"ENTITY_ERROR","title":"limit","detail":"too many"}]}"#
                    .into(),
            )
        }))
        .await;
        let client = AscClient::for_test(Credentials_for_tests(), base);
        let err = ensure_certificate(
            &client,
            &openssl,
            data.path(),
            "com.zeta.app",
            "N",
            "a@b.co",
            "pw",
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("ENTITY_ERROR"));
        let dir = data.path().join("signing/com.zeta.app");
        assert_eq!(std::fs::read_dir(dir).unwrap().count(), 0);
    }

    fn profile_bytes() -> Vec<u8> {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Name</key><string>P</string><key>UUID</key><string>U-1</string>
<key>TeamIdentifier</key><array><string>TEAM123456</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM123456.com.zeta.app</string><key>get-task-allow</key><false/></dict></dict></plist>"#;
        let mut b = vec![0x30, 0x82];
        b.extend(xml.bytes());
        b
    }

    fn tiny_ipa(path: &Path) {
        let mut w = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        w.start_file("Payload/App.app/App", o).unwrap();
        w.write_all(b"bin").unwrap();
        w.finish().unwrap();
    }

    #[tokio::test]
    async fn signing_embeds_profile_passes_secrets_by_file_and_cleans_up() {
        let tools = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let log = tools.path().join("args.log");
        let rc = script(
            tools.path(),
            "rcodesign",
            &format!(
                r#"echo "$@" > {log}
for last; do :; done
test -f "$last/embedded.mobileprovision" || exit 4
pw=""; ents=""; while [ $# -gt 0 ]; do case "$1" in --p12-password-file) pw=$2;; -e|--entitlements-xml-file) ents=$2;; esac; shift; done
test -f "$pw" || exit 5
grep -q 'get-task-allow' "$ents" || exit 6
echo signed > "$last/SIGNED""#,
                log = log.display()
            ),
        );
        let (ipa, out) = (data.path().join("in.ipa"), data.path().join("out.ipa"));
        tiny_ipa(&ipa);
        sign_ipa(
            &rc,
            data.path(),
            &ipa,
            &out,
            &profile_bytes(),
            Path::new("/x/d.p12"),
            "super-secret",
        )
        .await
        .unwrap();
        let z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
        assert!(z
            .file_names()
            .any(|n| n.as_deref().ok() == Some("Payload/App.app/SIGNED")));
        assert!(z
            .file_names()
            .any(|n| n.as_deref().ok() == Some("Payload/App.app/embedded.mobileprovision")));
        let args = std::fs::read_to_string(&log).unwrap();
        assert!(
            !args.contains("super-secret"),
            "password must not be in argv"
        );
        assert_eq!(
            std::fs::read_dir(data.path().join("tmp")).unwrap().count(),
            0,
            "work dir removed"
        );
    }

    #[tokio::test]
    async fn signing_failure_still_cleans_up_and_reports_the_tool_output() {
        let tools = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let rc = script(
            tools.path(),
            "rcodesign",
            "echo 'bad certificate' >&2; exit 2",
        );
        let (ipa, out) = (data.path().join("in.ipa"), data.path().join("out.ipa"));
        tiny_ipa(&ipa);
        let err = sign_ipa(
            &rc,
            data.path(),
            &ipa,
            &out,
            &profile_bytes(),
            Path::new("/x/d.p12"),
            "pw",
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("bad certificate"));
        assert!(!out.exists());
        assert_eq!(
            std::fs::read_dir(data.path().join("tmp")).unwrap().count(),
            0
        );
    }

    fn tarball(name: &str, body: &[u8]) -> Vec<u8> {
        let mut t = tar::Builder::new(Vec::new());
        let mut h = tar::Header::new_gnu();
        h.set_size(body.len() as u64);
        h.set_mode(0o644);
        h.set_cksum();
        t.append_data(&mut h, name, body).unwrap();
        let raw = t.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&raw).unwrap();
        gz.finish().unwrap()
    }

    #[test]
    fn tarball_install_checks_hash_and_extracts_only_the_binary() {
        let dir = tempfile::tempdir().unwrap();
        let tb = tarball("apple-codesign-0.29.0/rcodesign", b"BIN");
        let dest = dir.path().join("tools/rc/rcodesign");
        assert!(install_from_tarball(&tb, &"0".repeat(64), &dest).is_err());
        assert!(!dest.exists());
        install_from_tarball(&tb, &signing::sha256_hex(&tb), &dest).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"BIN");
        assert_eq!(
            std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
            0o755
        );
        let other = tarball("etc/evil", b"x");
        assert!(install_from_tarball(
            &other,
            &signing::sha256_hex(&other),
            &dir.path().join("o/rcodesign")
        )
        .is_err());
    }

    #[tokio::test]
    async fn download_refuses_urls_outside_the_allow_list() {
        let dir = tempfile::tempdir().unwrap();
        let r = download_and_install(
            "https://evil.example/rcodesign.tar.gz",
            "00",
            &dir.path().join("rc"),
            signing::is_allowed_download,
        )
        .await;
        assert!(matches!(r, Err(ReleaseError::Download(_))));
    }

    #[tokio::test]
    async fn ensure_rcodesign_prefers_path_then_installed_copy() {
        let tools = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let on_path = script(tools.path(), "rcodesign", "true");
        assert_eq!(
            ensure_rcodesign(data.path(), tools.path().as_os_str())
                .await
                .unwrap(),
            on_path
        );
        let installed = signing::rcodesign_install_path(data.path());
        std::fs::create_dir_all(installed.parent().unwrap()).unwrap();
        std::fs::write(&installed, "x").unwrap();
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(
            ensure_rcodesign(data.path(), empty.path().as_os_str())
                .await
                .unwrap(),
            installed
        );
    }

    #[test]
    fn random_hex_has_requested_length_and_differs() {
        let (a, b) = (random_hex(16).unwrap(), random_hex(16).unwrap());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }
}
