//! Bundled agent skills: files from the repository's `skills/` directory, embedded at compile time
//! and copied into `<workspace>/.claude/skills/<name>/` before a Claude Code session starts, so the
//! same design and workflow guidance is available in every iOS project without a manual
//! `npx skills add`. Existing files that differ are never overwritten.

use serde::Serialize;

use crate::fs_engine::{FsError, Workspace};

/// One bundled skill: its folder name under `.claude/skills/` and the files it consists of.
pub struct BundledSkill {
    pub name: &'static str,
    /// (relative path inside the skill folder, content)
    pub files: &'static [(&'static str, &'static str)],
}

pub const BUNDLED: &[BundledSkill] = &[
    BundledSkill {
        name: "ios-app-xtool",
        files: &[(
            "SKILL.md",
            include_str!("../../skills/ios-app-xtool/SKILL.md"),
        )],
    },
    BundledSkill {
        name: "mobile-ios-design",
        files: &[
            (
                "SKILL.md",
                include_str!("../../skills/mobile-ios-design/SKILL.md"),
            ),
            (
                "SOURCE.md",
                include_str!("../../skills/mobile-ios-design/SOURCE.md"),
            ),
        ],
    },
    BundledSkill {
        name: "find-skills",
        files: &[
            (
                "SKILL.md",
                include_str!("../../skills/find-skills/SKILL.md"),
            ),
            (
                "SOURCE.md",
                include_str!("../../skills/find-skills/SOURCE.md"),
            ),
        ],
    },
];

pub const SKILLS_DIR: &str = ".claude/skills";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    /// Files written (created or identical content refreshed).
    pub installed: Vec<String>,
    /// Files already present with the bundled content.
    pub unchanged: Vec<String>,
    /// Files present with different content; left untouched.
    pub kept: Vec<String>,
}

/// Copies every bundled skill into the workspace. Paths stay workspace-confined through
/// `Workspace::resolve`; a file whose content differs from the bundled one is kept as is.
pub fn install(workspace: &Workspace) -> Result<InstallReport, FsError> {
    let mut report = InstallReport::default();
    for skill in BUNDLED {
        for (file, content) in skill.files {
            let rel = format!("{SKILLS_DIR}/{}/{file}", skill.name);
            match workspace.read_file_if_exists(&rel)? {
                Some(existing) if existing == *content => report.unchanged.push(rel),
                Some(_) => report.kept.push(rel),
                None => {
                    workspace.write_file_creating_dirs(&rel, content)?;
                    report.installed.push(rel);
                }
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn front_matter_name(skill: &str) -> Option<String> {
        let mut lines = skill.lines();
        if lines.next()? != "---" {
            return None;
        }
        lines
            .take_while(|l| *l != "---")
            .find_map(|l| l.strip_prefix("name:").map(|v| v.trim().to_owned()))
    }

    #[test]
    fn every_bundled_skill_has_a_matching_skill_md() {
        for skill in BUNDLED {
            let (_, content) = skill
                .files
                .iter()
                .find(|(f, _)| *f == "SKILL.md")
                .expect("SKILL.md present");
            assert_eq!(
                front_matter_name(content).as_deref(),
                Some(skill.name),
                "front matter name must equal the folder name for {}",
                skill.name
            );
            assert!(
                content.contains("description:"),
                "{} needs a description",
                skill.name
            );
        }
    }

    #[test]
    fn install_creates_keeps_and_reports() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ws = Workspace::open(dir.path()).expect("workspace");

        let first = install(&ws).expect("install");
        let total: usize = BUNDLED.iter().map(|s| s.files.len()).sum();
        assert_eq!(first.installed.len(), total);
        assert!(first.kept.is_empty() && first.unchanged.is_empty());
        assert!(dir
            .path()
            .join(".claude/skills/ios-app-xtool/SKILL.md")
            .is_file());

        // A second run changes nothing.
        let second = install(&ws).expect("install again");
        assert!(second.installed.is_empty());
        assert_eq!(second.unchanged.len(), total);

        // A user-edited file is kept.
        let edited = ".claude/skills/find-skills/SKILL.md";
        ws.write_file(edited, "---\nname: find-skills\n---\nmine\n")
            .expect("edit");
        let third = install(&ws).expect("install after edit");
        assert_eq!(third.kept, vec![edited.to_owned()]);
        assert_eq!(third.unchanged.len(), total - 1);
        assert_eq!(
            ws.read_file(edited).expect("read"),
            "---\nname: find-skills\n---\nmine\n"
        );
    }

    #[test]
    fn names_are_unique_folder_safe_and_listed() {
        let names: Vec<&str> = BUNDLED.iter().map(|s| s.name).collect();
        for (i, n) in names.iter().enumerate() {
            assert!(
                n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "{n}"
            );
            assert!(!names[..i].contains(n), "duplicate {n}");
        }
    }
}
