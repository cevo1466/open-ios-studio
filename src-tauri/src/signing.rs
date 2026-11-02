//! Distribution-signing helpers (pure, no Tauri): provisioning-profile parsing,
//! entitlements generation, and the argv for `openssl` / `rcodesign`.
//!
//! Nothing here spawns a process or touches the network; callers run the returned
//! `runner::Spec`s. Secrets are never put in argv: the `.p12` password goes through a
//! 0600 file that the caller deletes afterwards.
//!
//! Status: argv shapes for `rcodesign sign` were checked against `rcodesign 0.29.0 --help`
//! (VERIFIED for flag names). A real signature with a real Apple certificate has NOT been
//! produced (NOT_VERIFIED until a paid account exists).

use std::path::{Path, PathBuf};
use std::time::Duration;

use plist::{Dictionary, Value};
use sha2::{Digest, Sha256};

use crate::runner::Spec;

pub const RCODESIGN_VERSION: &str = "0.29.0";
pub const RCODESIGN_URL: &str = "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz";
/// SHA-256 of the pinned tarball (matches the `.sha256` file published with the release).
pub const RCODESIGN_SHA256: &str =
    "dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002";
/// Only these hosts may serve the download (the release redirects to the GitHub CDN).
pub const RCODESIGN_ALLOWED_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

const TOOL_TIMEOUT: Duration = Duration::from_secs(120);
const SIGN_TIMEOUT: Duration = Duration::from_secs(900);

/// Hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn verify_sha256(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    let got = sha256_hex(bytes);
    if got.eq_ignore_ascii_case(expected_hex.trim()) {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 uyuşmuyor (beklenen {expected_hex}, gelen {got}); indirme reddedildi."
        ))
    }
}

/// True when `url` is https and its host is allow-listed.
pub fn is_allowed_download(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    !host.contains('@') && !host.contains(':') && RCODESIGN_ALLOWED_HOSTS.contains(&host)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProfileInfo {
    pub name: String,
    pub uuid: String,
    pub team_id: String,
    /// Full application identifier, e.g. `TEAMID.com.example.app`.
    pub app_id: String,
    pub expiration: Option<String>,
    pub get_task_allow: bool,
    /// True for development/ad-hoc profiles that list devices (not App Store).
    pub has_devices: bool,
    pub entitlements: Dictionary,
}

/// Parse a `.mobileprovision`: a CMS blob wrapping an XML plist. We only need the
/// embedded plist (no signature check; Apple's servers validate the real thing).
pub fn parse_profile(raw: &[u8]) -> Result<ProfileInfo, String> {
    let start =
        find(raw, b"<?xml").ok_or("Profilde plist bulunamadı (.mobileprovision değil mi?)")?;
    let end =
        find(&raw[start..], b"</plist>").ok_or("Profil plist'i eksik")? + start + b"</plist>".len();
    let v = Value::from_reader(std::io::Cursor::new(&raw[start..end]))
        .map_err(|e| format!("Profil okunamadı: {e}"))?;
    let d = v.as_dictionary().ok_or("Profil kökü sözlük değil")?;
    let text = |k: &str| d.get(k).and_then(Value::as_string).map(str::to_owned);
    let ents = d
        .get("Entitlements")
        .and_then(Value::as_dictionary)
        .cloned()
        .ok_or("Profilde Entitlements yok")?;
    let app_id = ents
        .get("application-identifier")
        .and_then(Value::as_string)
        .ok_or("Profilde application-identifier yok")?
        .to_owned();
    let team_id = d
        .get("TeamIdentifier")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_string)
        .map(str::to_owned)
        .or_else(|| app_id.split('.').next().map(str::to_owned))
        .ok_or("Takım kimliği bulunamadı")?;
    Ok(ProfileInfo {
        name: text("Name").unwrap_or_default(),
        uuid: text("UUID").ok_or("Profilde UUID yok")?,
        team_id,
        app_id,
        expiration: d
            .get("ExpirationDate")
            .and_then(Value::as_date)
            .map(|t| t.to_xml_format()),
        get_task_allow: ents
            .get("get-task-allow")
            .and_then(Value::as_boolean)
            .unwrap_or(false),
        has_devices: d.contains_key("ProvisionedDevices"),
        entitlements: ents,
    })
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Problems that would make Apple reject the upload; empty means none were found by this check.
pub fn check_profile_for_app_store(p: &ProfileInfo, bundle_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    if p.has_devices || p.get_task_allow {
        out.push("Profil App Store profili değil (geliştirme/ad-hoc görünüyor).".to_owned());
    }
    let want = format!("{}.{}", p.team_id, bundle_id);
    let wildcard = format!("{}.*", p.team_id);
    if p.app_id != want && p.app_id != wildcard {
        out.push(format!(
            "Profil kimliği {} bundle id ile ({bundle_id}) eşleşmiyor.",
            p.app_id
        ));
    }
    out
}

/// Entitlements XML for the final signature, derived from the profile.
pub fn entitlements_xml(p: &ProfileInfo) -> Result<Vec<u8>, String> {
    let mut d = Dictionary::new();
    d.insert(
        "application-identifier".into(),
        Value::String(p.app_id.clone()),
    );
    d.insert(
        "com.apple.developer.team-identifier".into(),
        Value::String(p.team_id.clone()),
    );
    d.insert("get-task-allow".into(), Value::Boolean(false));
    d.insert("beta-reports-active".into(), Value::Boolean(true));
    let mut buf = Vec::new();
    Value::Dictionary(d)
        .to_writer_xml(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Common name / email for the CSR subject: conservative charset, no `/` `=` `,`.
pub fn validate_subject_field(s: &str) -> Result<(), String> {
    let ok = !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '@' | '+'));
    if ok {
        Ok(())
    } else {
        Err("Ad/e-posta yalnızca harf, rakam, boşluk ve . - _ @ + içerebilir (en çok 64).".into())
    }
}

fn spec(program: &Path, args: Vec<String>, cwd: &Path, timeout: Duration) -> Spec {
    Spec {
        program: program.to_path_buf(),
        args,
        cwd: cwd.to_path_buf(),
        env: Vec::new(),
        timeout,
    }
}

/// New 2048-bit RSA key + CSR (for Apple's certificate request). Key is written unencrypted to
/// `key_out`; the caller creates that directory 0700 and the file is chmod 0600 right after.
pub fn csr_spec(
    openssl: &Path,
    cwd: &Path,
    key_out: &Path,
    csr_out: &Path,
    common_name: &str,
    email: &str,
) -> Result<Spec, String> {
    validate_subject_field(common_name)?;
    validate_subject_field(email)?;
    let subj = format!("/CN={common_name}/emailAddress={email}");
    let args = [
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        &path_str(key_out)?,
        "-out",
        &path_str(csr_out)?,
        "-subj",
        &subj,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    Ok(spec(openssl, args, cwd, TOOL_TIMEOUT))
}

/// Apple returns a DER `.cer`; `.p12` creation needs PEM.
pub fn der_to_pem_spec(
    openssl: &Path,
    cwd: &Path,
    cer: &Path,
    pem_out: &Path,
) -> Result<Spec, String> {
    let args = [
        "x509",
        "-inform",
        "DER",
        "-in",
        &path_str(cer)?,
        "-out",
        &path_str(pem_out)?,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    Ok(spec(openssl, args, cwd, TOOL_TIMEOUT))
}

/// Bundle key + certificate into a `.p12`; the password is read from `password_file`, never argv.
pub fn p12_spec(
    openssl: &Path,
    cwd: &Path,
    key: &Path,
    cert_pem: &Path,
    p12_out: &Path,
    password_file: &Path,
) -> Result<Spec, String> {
    let passout = format!("file:{}", path_str(password_file)?);
    let args = [
        "pkcs12",
        "-export",
        "-inkey",
        &path_str(key)?,
        "-in",
        &path_str(cert_pem)?,
        "-out",
        &path_str(p12_out)?,
        "-passout",
        &passout,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    Ok(spec(openssl, args, cwd, TOOL_TIMEOUT))
}

/// Sign an extracted `.app` bundle in place. Flags verified against rcodesign 0.29.0 `--help`.
pub fn rcodesign_sign_spec(
    rcodesign: &Path,
    cwd: &Path,
    app: &Path,
    p12: &Path,
    password_file: &Path,
    entitlements_xml: &Path,
) -> Result<Spec, String> {
    let args = [
        "sign",
        "--p12-file",
        &path_str(p12)?,
        "--p12-password-file",
        &path_str(password_file)?,
        "--entitlements-xml-file",
        &path_str(entitlements_xml)?,
        &path_str(app)?,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    Ok(spec(rcodesign, args, cwd, SIGN_TIMEOUT))
}

fn path_str(p: &Path) -> Result<String, String> {
    let s = p.to_str().ok_or("Yol UTF-8 değil")?;
    if s.starts_with('-') || s.contains('\0') {
        return Err("Güvensiz yol (tire ile başlıyor ya da NUL içeriyor).".into());
    }
    Ok(s.to_owned())
}

/// Where the pinned rcodesign lives inside the app data dir.
pub fn rcodesign_install_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join("tools")
        .join(format!("rcodesign-{RCODESIGN_VERSION}"))
        .join("rcodesign")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_blob(extra: &str, app_id: &str, task_allow: bool) -> Vec<u8> {
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Name</key><string>Zeta AppStore</string><key>UUID</key><string>AAAA-BBBB</string>
<key>TeamIdentifier</key><array><string>TEAM123456</string></array>
<key>ExpirationDate</key><date>2027-11-02T10:00:00Z</date>{extra}
<key>Entitlements</key><dict><key>application-identifier</key><string>{app_id}</string><key>get-task-allow</key><{}/></dict></dict></plist>"#,
            if task_allow { "true" } else { "false" }
        );
        let mut blob = vec![0x30, 0x82, 0x01, 0x00, 0xff];
        blob.extend(xml.bytes());
        blob.extend([0x00, 0x01, 0x02]);
        blob
    }

    #[test]
    fn sha256_matches_known_vector_and_rejects_mismatch() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(verify_sha256(
            b"abc",
            "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
        )
        .is_ok());
        assert!(verify_sha256(b"abd", RCODESIGN_SHA256).is_err());
    }

    #[test]
    fn download_allow_list_is_strict() {
        assert!(is_allowed_download(RCODESIGN_URL));
        for bad in [
            "http://github.com/x",
            "https://github.com.evil.com/x",
            "https://evil.com/github.com/",
            "https://user@github.com/x",
            "https://github.com:8443/x",
            "ftp://github.com/x",
        ] {
            assert!(!is_allowed_download(bad), "{bad}");
        }
    }

    #[test]
    fn parses_app_store_profile_out_of_cms_blob() {
        let p = parse_profile(&profile_blob("", "TEAM123456.com.zeta.app", false)).unwrap();
        assert_eq!(
            (p.uuid.as_str(), p.team_id.as_str(), p.app_id.as_str()),
            ("AAAA-BBBB", "TEAM123456", "TEAM123456.com.zeta.app")
        );
        assert!(!p.has_devices && !p.get_task_allow);
        assert!(p.expiration.is_some());
        assert!(check_profile_for_app_store(&p, "com.zeta.app").is_empty());
    }

    #[test]
    fn flags_dev_profiles_and_bundle_mismatch() {
        let dev = parse_profile(&profile_blob(
            "<key>ProvisionedDevices</key><array><string>x</string></array>",
            "TEAM123456.com.zeta.app",
            true,
        ))
        .unwrap();
        assert!(check_profile_for_app_store(&dev, "com.zeta.app")
            .iter()
            .any(|m| m.contains("App Store profili değil")));
        let ok = parse_profile(&profile_blob("", "TEAM123456.com.zeta.app", false)).unwrap();
        assert!(!check_profile_for_app_store(&ok, "com.other.app").is_empty());
        let wild = parse_profile(&profile_blob("", "TEAM123456.*", false)).unwrap();
        assert!(check_profile_for_app_store(&wild, "com.other.app").is_empty());
    }

    #[test]
    fn rejects_garbage_profiles() {
        assert!(parse_profile(b"no plist here").is_err());
        assert!(parse_profile(b"<?xml version='1.0'?><plist><dict></dict></plist>").is_err());
    }

    #[test]
    fn entitlements_are_derived_from_profile_and_never_debuggable() {
        let p = parse_profile(&profile_blob("", "TEAM123456.com.zeta.app", false)).unwrap();
        let xml = entitlements_xml(&p).unwrap();
        let v = Value::from_reader(std::io::Cursor::new(xml)).unwrap();
        let d = v.as_dictionary().unwrap();
        assert_eq!(
            d.get("get-task-allow").and_then(Value::as_boolean),
            Some(false)
        );
        assert_eq!(
            d.get("com.apple.developer.team-identifier")
                .and_then(Value::as_string),
            Some("TEAM123456")
        );
        assert_eq!(
            d.get("beta-reports-active").and_then(Value::as_boolean),
            Some(true)
        );
    }

    #[test]
    fn subject_fields_block_injection() {
        assert!(validate_subject_field("Open iOS Studio").is_ok());
        for bad in ["", "a/b", "a=b", "a,b", "x\ny", &"a".repeat(65)] {
            assert!(validate_subject_field(bad).is_err(), "{bad:?}");
        }
        let e = Path::new("/usr/bin/openssl");
        assert!(csr_spec(
            e,
            Path::new("/tmp"),
            Path::new("/k"),
            Path::new("/c"),
            "x/CN=evil",
            "a@b.c"
        )
        .is_err());
    }

    #[test]
    fn p12_password_goes_by_file_not_argv() {
        let s = p12_spec(
            Path::new("/usr/bin/openssl"),
            Path::new("/tmp"),
            Path::new("/d/k.pem"),
            Path::new("/d/c.pem"),
            Path::new("/d/o.p12"),
            Path::new("/d/pw"),
        )
        .unwrap();
        assert!(s.args.contains(&"file:/d/pw".to_owned()));
        let sign = rcodesign_sign_spec(
            Path::new("/r"),
            Path::new("/tmp"),
            Path::new("/w/Payload/A.app"),
            Path::new("/d/o.p12"),
            Path::new("/d/pw"),
            Path::new("/d/e.xml"),
        )
        .unwrap();
        assert_eq!(&sign.args[..2], ["sign", "--p12-file"]);
        assert!(
            sign.args.contains(&"--p12-password-file".to_owned())
                && !sign.args.contains(&"--p12-password".to_owned())
        );
        assert_eq!(
            sign.args.last().map(String::as_str),
            Some("/w/Payload/A.app")
        );
    }

    #[test]
    fn paths_starting_with_dash_are_refused() {
        assert!(der_to_pem_spec(
            Path::new("/o"),
            Path::new("/"),
            Path::new("-evil"),
            Path::new("/x")
        )
        .is_err());
    }

    #[test]
    fn install_path_is_versioned() {
        assert!(rcodesign_install_path(Path::new("/data"))
            .ends_with("tools/rcodesign-0.29.0/rcodesign"));
    }
}
