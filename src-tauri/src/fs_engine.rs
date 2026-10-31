//! Workspace-confined file access.
//!
//! Every path coming from the UI is a workspace-relative string. It is resolved against the
//! canonical workspace root; `..`, absolute paths and symlinks that leave the root are rejected.

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// Largest file the editor will read or write.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("path leaves the workspace: {0}")]
    Escape(String),
    #[error("invalid path: {0}")]
    Invalid(String),
    #[error("file is larger than {0} bytes")]
    TooLarge(u64),
    #[error("file is not valid UTF-8 text")]
    NotText,
    #[error("already exists: {0}")]
    Exists(String),
    #[error("not a directory: {0}")]
    NotDir(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    /// Workspace-relative path using `/` separators.
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub fn open(path: &Path) -> Result<Self, FsError> {
        let root = fs::canonicalize(path)?;
        if !root.is_dir() {
            return Err(FsError::NotDir(root.display().to_string()));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve a workspace-relative path to an absolute path that is guaranteed to stay inside
    /// the root, following symlinks of every part that already exists.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, FsError> {
        if rel.contains('\0') {
            return Err(FsError::Invalid(rel.replace('\0', "")));
        }
        let mut joined = self.root.clone();
        for component in Path::new(rel).components() {
            match component {
                Component::Normal(part) => joined.push(part),
                Component::CurDir => {}
                _ => return Err(FsError::Escape(rel.to_owned())),
            }
        }

        // Canonicalize the deepest existing ancestor, then re-append the not-yet-existing tail.
        let mut base = joined;
        let mut tail: Vec<OsString> = Vec::new();
        while fs::symlink_metadata(&base).is_err() {
            let name = base
                .file_name()
                .ok_or_else(|| FsError::Invalid(rel.to_owned()))?
                .to_owned();
            tail.push(name);
            if !base.pop() {
                return Err(FsError::Invalid(rel.to_owned()));
            }
        }
        let mut real = fs::canonicalize(&base).map_err(|_| FsError::Invalid(rel.to_owned()))?;
        if !real.starts_with(&self.root) {
            return Err(FsError::Escape(rel.to_owned()));
        }
        for name in tail.iter().rev() {
            real.push(name);
        }
        Ok(real)
    }

    fn rel_of(&self, abs: &Path) -> String {
        abs.strip_prefix(&self.root)
            .map(|p| {
                p.components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .unwrap_or_default()
    }

    pub fn list_dir(&self, rel: &str) -> Result<Vec<Entry>, FsError> {
        let dir = self.resolve(rel)?;
        if !dir.is_dir() {
            return Err(FsError::NotDir(rel.to_owned()));
        }
        let mut entries = Vec::new();
        for item in fs::read_dir(&dir)? {
            let item = item?;
            let name = item.file_name().to_string_lossy().into_owned();
            let child = if rel.is_empty() || rel == "." {
                name.clone()
            } else {
                format!("{}/{}", rel.trim_end_matches('/'), name)
            };
            // Entries whose symlink target leaves the workspace are hidden.
            let Ok(real) = self.resolve(&child) else {
                continue;
            };
            let is_dir = fs::metadata(&real).map(|m| m.is_dir()).unwrap_or(false);
            entries.push(Entry {
                name,
                path: self.rel_of(&item.path().canonicalize().unwrap_or(real)),
                is_dir,
            });
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn read_file(&self, rel: &str) -> Result<String, FsError> {
        let path = self.resolve(rel)?;
        let meta = fs::metadata(&path)?;
        if meta.is_dir() {
            return Err(FsError::Invalid(rel.to_owned()));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(FsError::TooLarge(MAX_FILE_BYTES));
        }
        String::from_utf8(fs::read(&path)?).map_err(|_| FsError::NotText)
    }

    /// Atomic replace: write a sibling temp file, fsync, then rename over the target.
    pub fn write_file(&self, rel: &str, content: &str) -> Result<(), FsError> {
        if content.len() as u64 > MAX_FILE_BYTES {
            return Err(FsError::TooLarge(MAX_FILE_BYTES));
        }
        let target = self.resolve(rel)?;
        if target.is_dir() {
            return Err(FsError::Invalid(rel.to_owned()));
        }
        let parent = target
            .parent()
            .ok_or_else(|| FsError::Invalid(rel.to_owned()))?;
        let name = target
            .file_name()
            .ok_or_else(|| FsError::Invalid(rel.to_owned()))?
            .to_string_lossy();
        let tmp = parent.join(format!(".{}.studio-tmp-{}", name, std::process::id()));

        let result = (|| -> Result<(), FsError> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
            if let Ok(meta) = fs::metadata(&target) {
                fs::set_permissions(&tmp, meta.permissions())?;
            }
            fs::rename(&tmp, &target)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result
    }

    pub fn create_file(&self, rel: &str) -> Result<(), FsError> {
        let target = self.resolve(rel)?;
        if fs::symlink_metadata(&target).is_ok() {
            return Err(FsError::Exists(rel.to_owned()));
        }
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().expect("tempdir");
        let ws = Workspace::open(dir.path()).expect("open");
        (dir, ws)
    }

    #[test]
    fn rejects_parent_and_absolute_paths() {
        let (_d, ws) = ws();
        assert!(matches!(ws.resolve("../x"), Err(FsError::Escape(_))));
        assert!(matches!(ws.resolve("a/../../x"), Err(FsError::Escape(_))));
        assert!(matches!(ws.resolve("/etc/passwd"), Err(FsError::Escape(_))));
        assert!(matches!(ws.resolve("a\0b"), Err(FsError::Invalid(_))));
    }

    #[test]
    fn resolves_missing_tail_inside_root() {
        let (_d, ws) = ws();
        let p = ws.resolve("new/dir/file.swift").expect("resolve");
        assert!(p.starts_with(ws.root()));
    }

    #[cfg(unix)]
    #[test]
    fn blocks_symlink_escape() {
        let (_d, ws) = ws();
        let outside = tempfile::tempdir().expect("outside");
        fs::write(outside.path().join("secret.txt"), "top secret").expect("write");
        std::os::unix::fs::symlink(outside.path(), ws.root().join("link")).expect("symlink");
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            ws.root().join("file-link"),
        )
        .expect("symlink");

        assert!(matches!(
            ws.resolve("link/secret.txt"),
            Err(FsError::Escape(_))
        ));
        assert!(matches!(ws.read_file("file-link"), Err(FsError::Escape(_))));
        assert!(matches!(
            ws.write_file("link/new.txt", "x"),
            Err(FsError::Escape(_))
        ));
        // Escaping links are hidden from listings.
        assert!(ws.list_dir("").expect("list").is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn allows_symlink_inside_workspace() {
        let (_d, ws) = ws();
        fs::write(ws.root().join("real.txt"), "hi").expect("write");
        std::os::unix::fs::symlink(ws.root().join("real.txt"), ws.root().join("alias.txt"))
            .expect("symlink");
        assert_eq!(ws.read_file("alias.txt").expect("read"), "hi");
    }

    #[test]
    fn atomic_write_roundtrip_leaves_no_temp_files() {
        let (_d, ws) = ws();
        ws.create_file("a.swift").expect("create");
        ws.write_file("a.swift", "let x = 1\n").expect("write");
        ws.write_file("a.swift", "let x = 2\n").expect("overwrite");
        assert_eq!(ws.read_file("a.swift").expect("read"), "let x = 2\n");
        let names: Vec<_> = fs::read_dir(ws.root())
            .expect("read_dir")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.swift".to_owned()]);
    }

    #[test]
    fn write_into_missing_directory_fails() {
        let (_d, ws) = ws();
        assert!(ws.write_file("missing/dir/a.txt", "x").is_err());
    }

    #[test]
    fn create_refuses_existing_file() {
        let (_d, ws) = ws();
        ws.create_file("a.txt").expect("create");
        assert!(matches!(ws.create_file("a.txt"), Err(FsError::Exists(_))));
    }

    #[test]
    fn read_rejects_large_and_binary_files() {
        let (_d, ws) = ws();
        fs::write(
            ws.root().join("big.txt"),
            vec![b'a'; (MAX_FILE_BYTES + 1) as usize],
        )
        .expect("write");
        assert!(matches!(ws.read_file("big.txt"), Err(FsError::TooLarge(_))));
        fs::write(ws.root().join("bin.dat"), [0xff, 0xfe, 0x00]).expect("write");
        assert!(matches!(ws.read_file("bin.dat"), Err(FsError::NotText)));
        assert!(matches!(
            ws.write_file("big2.txt", &"a".repeat((MAX_FILE_BYTES + 1) as usize)),
            Err(FsError::TooLarge(_))
        ));
    }

    #[test]
    fn lists_directories_first_with_relative_paths() {
        let (_d, ws) = ws();
        fs::create_dir(ws.root().join("Sources")).expect("mkdir");
        fs::write(ws.root().join("Package.swift"), "").expect("write");
        fs::write(ws.root().join("Sources").join("App.swift"), "").expect("write");
        let root = ws.list_dir("").expect("list");
        assert_eq!(root[0].name, "Sources");
        assert!(root[0].is_dir);
        assert_eq!(root[1].path, "Package.swift");
        let sub = ws.list_dir("Sources").expect("list sub");
        assert_eq!(sub[0].path, "Sources/App.swift");
    }
}
