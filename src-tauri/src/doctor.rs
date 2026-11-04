//! Environment check ("doctor"): read-only probes of the tools an iOS build needs on this
//! machine. Each check is an id plus a status and a short detail; the webview supplies the
//! Turkish label and the fix hint. Nothing here installs, logs in or changes anything.
//! The same checks exist as `scripts/doctor.sh` for use from a terminal.

use std::ffi::OsStr;
use std::path::Path;

use serde::Serialize;

use crate::xtool::{find_in_path, probe};

/// Status vocabulary shared with `scripts/doctor.sh` and CLAUDE.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Status {
    Pass,
    Fail,
    Warn,
    NotVerified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: &'static str,
    pub status: Status,
    /// One line, taken from the tool's own output where possible.
    pub detail: String,
}

/// The xtool release whose CLI fixtures live in `fixtures/xtool-<version>/`.
pub const TESTED_XTOOL_VERSION: &str = "1.24.0";

fn check(id: &'static str, status: Status, detail: impl Into<String>) -> Check {
    Check {
        id,
        status,
        detail: detail.into(),
    }
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or_default().trim().to_owned()
}

/// First dotted number in `s` ("xtool 1.24.0" -> "1.24.0").
pub fn version_in(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            let candidate = s[start..i].trim_end_matches('.');
            if candidate.contains('.') {
                return Some(candidate.to_owned());
            }
        } else {
            i += 1;
        }
    }
    None
}

fn parts(v: &str) -> Vec<u64> {
    v.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// Compares dotted versions numerically (missing components count as 0).
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (parts(a), parts(b));
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// `xtool --version` output -> check.
pub fn classify_xtool_version(output: &str) -> Check {
    match version_in(output) {
        None => check(
            "xtool",
            Status::Warn,
            format!("version not recognised: {}", first_line(output)),
        ),
        Some(v) => match compare_versions(&v, TESTED_XTOOL_VERSION) {
            std::cmp::Ordering::Equal => check("xtool", Status::Pass, format!("{v} (tested)")),
            std::cmp::Ordering::Greater => check(
                "xtool",
                Status::Warn,
                format!("{v} is newer than the tested {TESTED_XTOOL_VERSION}"),
            ),
            std::cmp::Ordering::Less => check(
                "xtool",
                Status::Warn,
                format!("{v} is older than the tested {TESTED_XTOOL_VERSION}"),
            ),
        },
    }
}

/// `swift sdk list` output -> check (PASS when a Darwin SDK is listed).
pub fn classify_sdk_list(output: &str) -> Check {
    match output
        .lines()
        .find(|l| l.to_ascii_lowercase().contains("darwin"))
    {
        Some(line) => check("darwin-sdk", Status::Pass, line.trim()),
        None => check("darwin-sdk", Status::Fail, "no 'darwin' SDK installed"),
    }
}

/// `xtool sdk status` output -> check.
pub fn classify_sdk_status(output: &str) -> Check {
    let line = first_line(output);
    if line.to_ascii_lowercase().contains("not installed") {
        check("xtool-sdk", Status::Fail, line)
    } else {
        check("xtool-sdk", Status::Pass, line)
    }
}

/// `xtool auth status` output -> check (WARN when logged out: building works, installing does not).
pub fn classify_auth_status(output: &str) -> Check {
    let line = first_line(output);
    if line.to_ascii_lowercase().contains("logged out") {
        check("apple-account", Status::Warn, line)
    } else {
        check("apple-account", Status::Pass, line)
    }
}

/// `xtool devices --no-wait` output -> check.
pub fn classify_devices(output: &str) -> Check {
    let line = first_line(output);
    if line.is_empty() {
        check("device", Status::Warn, "no iPhone connected")
    } else {
        check("device", Status::Pass, line)
    }
}

/// Runs every probe. Blocking (each probe has its own timeout); call from a blocking task.
pub fn run(path_var: &OsStr, cwd: &Path) -> Vec<Check> {
    let mut out = Vec::new();

    let swift = find_in_path("swift", path_var);
    match &swift {
        Some(p) => match probe(p, &["--version"], cwd) {
            Ok(v) => out.push(check("swift", Status::Pass, first_line(&v))),
            Err(e) => out.push(check(
                "swift",
                Status::Fail,
                format!("swift --version failed: {e}"),
            )),
        },
        None => out.push(check("swift", Status::Fail, "swift is not on PATH")),
    }

    match &swift {
        Some(p) => match probe(p, &["sdk", "list"], cwd) {
            Ok(v) => out.push(classify_sdk_list(&v)),
            Err(e) => out.push(check(
                "darwin-sdk",
                Status::NotVerified,
                format!("swift sdk list failed: {e}"),
            )),
        },
        None => out.push(check(
            "darwin-sdk",
            Status::NotVerified,
            "skipped: Swift is missing",
        )),
    }

    let xtool = find_in_path("xtool", path_var);
    match &xtool {
        Some(p) => match probe(p, &["--version"], cwd) {
            Ok(v) => out.push(classify_xtool_version(&v)),
            Err(e) => out.push(check(
                "xtool",
                Status::Fail,
                format!("xtool --version failed: {e}"),
            )),
        },
        None => out.push(check("xtool", Status::Fail, "xtool is not on PATH")),
    }

    for (id, args, classify) in [
        (
            "xtool-sdk",
            &["sdk", "status"][..],
            classify_sdk_status as fn(&str) -> Check,
        ),
        (
            "apple-account",
            &["auth", "status"][..],
            classify_auth_status,
        ),
        ("device", &["devices", "--no-wait"][..], classify_devices),
    ] {
        match &xtool {
            Some(p) => match probe(p, args, cwd) {
                Ok(v) => out.push(classify(&v)),
                Err(e) => out.push(check(
                    id,
                    Status::NotVerified,
                    format!("command failed: {e}"),
                )),
            },
            None => out.push(check(id, Status::NotVerified, "skipped: xtool is missing")),
        }
    }

    let usbmuxd = find_in_path("usbmuxd", path_var).is_some()
        || Path::new("/usr/sbin/usbmuxd").is_file()
        || Path::new("/usr/bin/usbmuxd").is_file();
    out.push(if usbmuxd {
        check("usbmuxd", Status::Pass, "installed")
    } else {
        check("usbmuxd", Status::Warn, "not installed")
    });

    // Optional: lets the iPhone screen be mirrored to this desktop (AirPlay receiver).
    let uxplay =
        find_in_path("uxplay", path_var).is_some() || Path::new("/usr/bin/uxplay").is_file();
    out.push(if uxplay {
        check("screen-mirror", Status::Pass, "uxplay installed")
    } else {
        check(
            "screen-mirror",
            Status::Warn,
            "uxplay not installed (optional)",
        )
    });

    out.push(match find_in_path("git", path_var) {
        Some(_) => check("git", Status::Pass, "installed"),
        None => check("git", Status::Warn, "not installed"),
    });

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn versions_are_parsed_and_compared() {
        assert_eq!(version_in("xtool 1.24.0").as_deref(), Some("1.24.0"));
        assert_eq!(
            version_in("Swift version 6.1 (swift-6.1-RELEASE)").as_deref(),
            Some("6.1")
        );
        assert_eq!(version_in("no digits"), None);
        assert_eq!(compare_versions("1.24.0", "1.24"), Ordering::Equal);
        assert_eq!(compare_versions("1.23.9", "1.24.0"), Ordering::Less);
        assert_eq!(compare_versions("1.25", "1.24.0"), Ordering::Greater);
    }

    #[test]
    fn xtool_version_classification() {
        assert_eq!(classify_xtool_version("xtool 1.24.0").status, Status::Pass);
        assert_eq!(classify_xtool_version("xtool 1.30.0").status, Status::Warn);
        assert_eq!(classify_xtool_version("xtool 1.2.0").status, Status::Warn);
        assert_eq!(classify_xtool_version("garbage").status, Status::Warn);
    }

    #[test]
    fn fixture_outputs_classify_as_documented() {
        // fixtures/xtool-1.24.0/sdk-status.stdout and auth-status.stdout
        assert_eq!(classify_sdk_status("Not installed").status, Status::Fail);
        assert_eq!(
            classify_sdk_status("Installed at /home/u/.xtool/sdk").status,
            Status::Pass
        );
        assert_eq!(classify_auth_status("Logged out").status, Status::Warn);
        assert_eq!(
            classify_auth_status("Logged in as Team").status,
            Status::Pass
        );
        assert_eq!(classify_devices("").status, Status::Warn);
        assert_eq!(
            classify_devices("00008030-0001 iPhone").status,
            Status::Pass
        );
        assert_eq!(classify_sdk_list("ID\n--\nmy-linux\n").status, Status::Fail);
        assert_eq!(
            classify_sdk_list("ID\n--\ndarwin\n"),
            Check {
                id: "darwin-sdk",
                status: Status::Pass,
                detail: "darwin".to_owned()
            }
        );
    }

    #[test]
    fn run_without_tools_reports_fail_and_not_verified_never_pass_for_toolchain() {
        let dir = tempfile::tempdir().expect("tempdir");
        let checks = run(OsStr::new(dir.path().to_str().expect("utf8")), dir.path());
        let get = |id: &str| checks.iter().find(|c| c.id == id).expect(id).status;
        assert_eq!(get("swift"), Status::Fail);
        assert_eq!(get("darwin-sdk"), Status::NotVerified);
        assert_eq!(get("xtool"), Status::Fail);
        assert_eq!(get("xtool-sdk"), Status::NotVerified);
        assert_eq!(get("apple-account"), Status::NotVerified);
        assert_eq!(get("device"), Status::NotVerified);
        let ids: Vec<&str> = checks.iter().map(|c| c.id).collect();
        assert_eq!(
            ids,
            [
                "swift",
                "darwin-sdk",
                "xtool",
                "xtool-sdk",
                "apple-account",
                "device",
                "usbmuxd",
                "screen-mirror",
                "git"
            ]
        );
    }
}
