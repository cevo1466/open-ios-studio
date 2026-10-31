//! xtool CLI adapter: locating the binary and turning allow-listed operations into commands.
//! The webview names an operation; this module builds the argument vector. Raw argv from the UI
//! is never accepted.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::fs_engine::Workspace;
use crate::runner::{self, CancelToken, Spec, Stream};

const DETECT_TIMEOUT: Duration = Duration::from_secs(30);
const QUICK_TIMEOUT: Duration = Duration::from_secs(120);
const BUILD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct XtoolInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version_output: Option<String>,
    pub swift_version_output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArgs {
    pub name: Option<String>,
    pub project: Option<String>,
    pub configuration: Option<String>,
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// First executable called `name` in the given PATH-style variable.
pub fn find_in_path(name: &str, path_var: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_var)
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
}

/// xtool's own rule for package names (`NewCommand.swift`): first char `[A-Za-z_]`, rest `[A-Za-z0-9_-]`.
pub fn validate_project_name(name: &str) -> Result<(), String> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return Err("The package name must not be empty.".to_owned());
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(format!(
            "The package name must start with a letter or underscore, found '{first}'."
        ));
    }
    if let Some(bad) = chars.find(|c| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '-')) {
        return Err(format!(
            "The package name may only contain letters, digits, '_' and '-', found '{bad}'."
        ));
    }
    Ok(())
}

fn tool_spec(program: &Path, args: &[&str], cwd: &Path, timeout: Duration) -> Spec {
    Spec {
        program: program.to_path_buf(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        cwd: cwd.to_path_buf(),
        // The release is an AppImage; this lets it run without FUSE.
        env: vec![("APPIMAGE_EXTRACT_AND_RUN".to_owned(), "1".to_owned())],
        timeout,
    }
}

/// Run a short command and return its combined output, trimmed.
fn probe(program: &Path, args: &[&str], cwd: &Path) -> Result<String, String> {
    let spec = tool_spec(program, args, cwd, DETECT_TIMEOUT);
    let mut lines: Vec<String> = Vec::new();
    let info = runner::run(&spec, &CancelToken::new(), |_: Stream, text| {
        if lines.len() < 20 {
            lines.push(text);
        }
    })
    .map_err(|e| e.to_string())?;
    if info.timed_out {
        return Err("timed out".to_owned());
    }
    if info.code != Some(0) {
        return Err(format!("exited with {:?}: {}", info.code, lines.join(" | ")));
    }
    Ok(lines.join("\n").trim().to_owned())
}

pub fn detect(path_var: &OsStr, cwd: &Path) -> XtoolInfo {
    let mut info = XtoolInfo::default();
    if let Some(swift) = find_in_path("swift", path_var) {
        info.swift_version_output = probe(&swift, &["--version"], cwd).ok();
    }
    let Some(xtool) = find_in_path("xtool", path_var) else {
        info.error = Some("xtool was not found on PATH.".to_owned());
        return info;
    };
    info.found = true;
    info.path = Some(xtool.display().to_string());
    match probe(&xtool, &["--version"], cwd) {
        Ok(out) => info.version_output = Some(out),
        Err(e) => info.error = Some(format!("`xtool --version` failed: {e}")),
    }
    info
}

/// Build the command for an allow-listed operation.
pub fn build_spec(
    op: &str,
    args: &RunArgs,
    xtool: &Path,
    workspace: &Workspace,
) -> Result<Spec, String> {
    let root = workspace.root();
    match op {
        "version" => Ok(tool_spec(xtool, &["--version"], root, QUICK_TIMEOUT)),
        "sdk-status" => Ok(tool_spec(xtool, &["sdk", "status"], root, QUICK_TIMEOUT)),
        "new" => {
            let name = args.name.as_deref().unwrap_or_default();
            validate_project_name(name)?;
            if workspace.resolve(name).map_err(|e| e.to_string())?.exists() {
                return Err(format!("{name} already exists in this folder."));
            }
            Ok(tool_spec(
                xtool,
                &["new", "--skip-setup", name],
                root,
                QUICK_TIMEOUT,
            ))
        }
        "build" => {
            let rel = args.project.as_deref().unwrap_or("");
            let dir = workspace.resolve(rel).map_err(|e| e.to_string())?;
            if !dir.join("Package.swift").is_file() {
                return Err("No Package.swift in the selected project folder.".to_owned());
            }
            let configuration = match args.configuration.as_deref() {
                None | Some("debug") => "debug",
                Some("release") => "release",
                Some(other) => return Err(format!("Unknown configuration '{other}'.")),
            };
            Ok(tool_spec(
                xtool,
                &["dev", "build", "--configuration", configuration],
                &dir,
                BUILD_TIMEOUT,
            ))
        }
        other => Err(format!("Unknown operation '{other}'.")),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    fn ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().expect("tempdir");
        let ws = Workspace::open(dir.path()).expect("open");
        (dir, ws)
    }

    fn fake(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    #[test]
    fn project_name_rules_match_xtool() {
        assert!(validate_project_name("My-App_2").is_ok());
        assert!(validate_project_name("_x").is_ok());
        for bad in ["", "2app", "-x", "a b", "a/b", "ünï", "a.b"] {
            assert!(validate_project_name(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn finds_only_executables_in_path_order() {
        let a = tempfile::tempdir().expect("a");
        let b = tempfile::tempdir().expect("b");
        fs::write(a.path().join("xtool"), "not executable").expect("write");
        let wanted = fake(b.path(), "xtool", "echo hi");
        let path = std::env::join_paths([a.path(), b.path()]).expect("join");
        assert_eq!(find_in_path("xtool", &path), Some(wanted));
        assert_eq!(find_in_path("nothing-here", &path), None);
    }

    #[test]
    fn detect_reports_missing_xtool() {
        let (dir, _ws) = ws();
        let empty = tempfile::tempdir().expect("empty");
        let info = detect(empty.path().as_os_str(), dir.path());
        assert!(!info.found);
        assert!(info.error.is_some());
    }

    #[test]
    fn detect_reads_version_from_a_fake_xtool() {
        let (dir, _ws) = ws();
        let bin = tempfile::tempdir().expect("bin");
        fake(bin.path(), "xtool", "echo 'xtool 1.24.0'");
        let info = detect(bin.path().as_os_str(), dir.path());
        assert!(info.found);
        assert_eq!(info.version_output.as_deref(), Some("xtool 1.24.0"));
        assert_eq!(info.error, None);
    }

    #[test]
    fn detect_reports_a_failing_xtool() {
        let (dir, _ws) = ws();
        let bin = tempfile::tempdir().expect("bin");
        fake(bin.path(), "xtool", "echo boom >&2\nexit 9");
        let info = detect(bin.path().as_os_str(), dir.path());
        assert!(info.found);
        assert!(info.version_output.is_none());
        assert!(info.error.expect("error").contains("failed"));
    }

    #[test]
    fn new_builds_a_fixed_argument_vector() {
        let (_d, ws) = ws();
        let args = RunArgs { name: Some("Demo".into()), ..RunArgs::default() };
        let spec = build_spec("new", &args, Path::new("/usr/bin/xtool"), &ws).expect("spec");
        assert_eq!(spec.args, ["new", "--skip-setup", "Demo"]);
        assert_eq!(spec.cwd, ws.root());
    }

    #[test]
    fn new_rejects_option_like_and_existing_names() {
        let (_d, ws) = ws();
        let xtool = Path::new("/usr/bin/xtool");
        for bad in ["--help", "a b", "x;rm"] {
            let args = RunArgs { name: Some(bad.into()), ..RunArgs::default() };
            assert!(build_spec("new", &args, xtool, &ws).is_err(), "{bad}");
        }
        fs::create_dir(ws.root().join("Taken")).expect("mkdir");
        let args = RunArgs { name: Some("Taken".into()), ..RunArgs::default() };
        assert!(build_spec("new", &args, xtool, &ws).is_err());
    }

    #[test]
    fn build_requires_package_swift_and_known_configuration() {
        let (_d, ws) = ws();
        let xtool = Path::new("/usr/bin/xtool");
        assert!(build_spec("build", &RunArgs::default(), xtool, &ws).is_err());
        fs::write(ws.root().join("Package.swift"), "").expect("write");
        let spec = build_spec("build", &RunArgs::default(), xtool, &ws).expect("spec");
        assert_eq!(spec.args, ["dev", "build", "--configuration", "debug"]);
        let bad = RunArgs { configuration: Some("--evil".into()), ..RunArgs::default() };
        assert!(build_spec("build", &bad, xtool, &ws).is_err());
        let escape = RunArgs { project: Some("../outside".into()), ..RunArgs::default() };
        assert!(build_spec("build", &escape, xtool, &ws).is_err());
    }

    #[test]
    fn unknown_operations_are_rejected() {
        let (_d, ws) = ws();
        let xtool = Path::new("/usr/bin/xtool");
        for op in ["auth", "auth-login", "sdk-install", "rm"] {
            assert!(build_spec(op, &RunArgs::default(), xtool, &ws).is_err(), "{op}");
        }
    }
}
