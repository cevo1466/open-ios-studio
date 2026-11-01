//! Show a workspace item in the system file manager (ADR-0010).
//!
//! The path is resolved inside the workspace by the caller (`Workspace::resolve`), the only
//! program started is `xdg-open`, and the single argument is an absolute directory.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::cli_ai::find_program;

/// Directory to show: the item's own directory (for a bundle such as `Demo.app`), otherwise its
/// parent. With `parent` the containing directory is always used.
pub fn reveal_target(abs: &Path, parent: bool) -> Result<PathBuf, String> {
    let dir = if !parent && abs.is_dir() {
        abs.to_path_buf()
    } else {
        abs.parent()
            .ok_or_else(|| "The item has no containing folder.".to_owned())?
            .to_path_buf()
    };
    if !dir.is_absolute() || !dir.is_dir() {
        return Err("The folder does not exist.".to_owned());
    }
    Ok(dir)
}

/// Opens `dir` with `xdg-open`. The environment is inherited on purpose: the desktop session
/// variables (`DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, ...) are what make the file manager open.
pub fn open_in_file_manager(dir: &Path) -> Result<(), String> {
    let program = find_program("xdg-open")
        .ok_or_else(|| "`xdg-open` is not installed, so the folder cannot be opened.".to_owned())?;
    let mut child = Command::new(program)
        .arg(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn directory_item_opens_itself_and_file_opens_its_parent() {
        let root = tempfile::tempdir().expect("tmp");
        let app = root.path().join("Demo.app");
        fs::create_dir(&app).expect("mkdir");
        let file = root.path().join("ipa.bin");
        fs::write(&file, [0u8, 1, 2]).expect("write");
        assert_eq!(reveal_target(&app, false).expect("self"), app);
        assert_eq!(reveal_target(&app, true).expect("parent"), root.path());
        assert_eq!(reveal_target(&file, false).expect("file"), root.path());
        assert_eq!(reveal_target(&file, true).expect("file parent"), root.path());
    }

    #[test]
    fn missing_folder_is_an_error() {
        assert!(reveal_target(Path::new("/definitely/not/here/x"), false).is_err());
    }
}
