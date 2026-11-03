//! In-app update check and download.
//!
//! Talks only to the GitHub Releases API of this repository (pinned constant) and downloads
//! release assets from GitHub, verifying each file against the `SHA256SUMS.txt` published with
//! the release. It never installs a DEB (that needs root; the user runs the shown `apt` command)
//! but it can replace the running AppImage file in place after the checksum matched.

use std::cmp::Ordering;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::doctor::compare_versions;

const RELEASES_API: &str =
    "https://api.github.com/repos/cevo1466/open-ios-studio/releases?per_page=10";
const RELEASES_ATOM: &str = "https://github.com/cevo1466/open-ios-studio/releases.atom";
const DOWNLOAD_PREFIX: &str = "https://github.com/cevo1466/open-ios-studio/releases/download/";
const MAX_FEED_BYTES: usize = 2 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const API_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_ASSET_BYTES: u64 = 400 * 1024 * 1024;
const MAX_SUMS_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    Deb,
    AppImage,
    Checksums,
    Other,
}

/// How this copy of the app was installed, which decides the asset to offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallKind {
    AppImage,
    Deb,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub name: String,
    pub size: u64,
    pub kind: AssetKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub html_url: String,
    pub assets: Vec<AssetInfo>,
    pub install_kind: InstallKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub name: String,
    pub sha256: String,
    /// Command the user runs to install (DEB); `None` for an AppImage.
    pub install_command: Option<String>,
    /// True when the running AppImage can be replaced by the downloaded file.
    pub can_replace_running_appimage: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub html_url: String,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    #[serde(default)]
    pub size: u64,
    pub browser_download_url: String,
}

/// `v1.2.3` or `1.2.3` -> `1.2.3`; anything else is rejected.
pub fn parse_tag(tag: &str) -> Option<String> {
    let v = tag.strip_prefix('v').unwrap_or(tag);
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit()))
    {
        return None;
    }
    Some(v.to_owned())
}

pub fn asset_kind(name: &str) -> AssetKind {
    if name == "SHA256SUMS.txt" {
        AssetKind::Checksums
    } else if name.ends_with(".deb") {
        AssetKind::Deb
    } else if name.ends_with(".AppImage") {
        AssetKind::AppImage
    } else {
        AssetKind::Other
    }
}

/// The newest published release, pre-releases included (every release of this project starts as
/// one); drafts and releases without a `vX.Y.Z` tag are skipped.
pub fn pick_release(releases: &[Release]) -> Option<&Release> {
    releases
        .iter()
        .find(|r| !r.draft && parse_tag(&r.tag_name).is_some())
}

/// Decides from the environment how the app was installed. Pure for testing.
pub fn install_kind_from(appimage_env: Option<&str>, exe: Option<&Path>) -> InstallKind {
    if appimage_env
        .map(|p| p.ends_with(".AppImage"))
        .unwrap_or(false)
    {
        return InstallKind::AppImage;
    }
    match exe {
        Some(p)
            if p.starts_with("/usr/bin") || p.starts_with("/usr/lib") || p.starts_with("/opt") =>
        {
            InstallKind::Deb
        }
        _ => InstallKind::Unknown,
    }
}

fn current_install_kind() -> InstallKind {
    let appimage = std::env::var("APPIMAGE").ok();
    let exe = std::env::current_exe().ok();
    install_kind_from(appimage.as_deref(), exe.as_deref())
}

pub fn info_from(current: &str, release: &Release) -> UpdateInfo {
    let latest = parse_tag(&release.tag_name).unwrap_or_else(|| release.tag_name.clone());
    UpdateInfo {
        current: current.to_owned(),
        newer: compare_versions(&latest, current) == Ordering::Greater,
        latest,
        prerelease: release.prerelease,
        published_at: release.published_at.clone(),
        html_url: release.html_url.clone(),
        assets: release
            .assets
            .iter()
            .map(|a| AssetInfo {
                name: a.name.clone(),
                size: a.size,
                kind: asset_kind(&a.name),
            })
            .collect(),
        install_kind: current_install_kind(),
    }
}

/// Parses `sha256sum` output: `<hex>  <name>` per line (a leading `*` on the name is allowed).
pub fn parse_sha256sums(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let hex = it.next()?;
            let name = it.next()?.trim_start_matches('*');
            if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) || name.is_empty() {
                return None;
            }
            Some((hex.to_ascii_lowercase(), name.to_owned()))
        })
        .collect()
}

pub fn sha256_of_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Where downloads go: `$XDG_DOWNLOAD_DIR`, then `~/Downloads` if it exists, then `~`.
pub fn downloads_dir_from(xdg: Option<&str>, home: Option<&str>) -> Option<PathBuf> {
    if let Some(x) = xdg.filter(|s| !s.is_empty()) {
        let p = PathBuf::from(x);
        if p.is_dir() {
            return Some(p);
        }
    }
    let home = PathBuf::from(home.filter(|s| !s.is_empty())?);
    let dl = home.join("Downloads");
    if dl.is_dir() {
        return Some(dl);
    }
    home.is_dir().then_some(home)
}

fn downloads_dir() -> Result<PathBuf, String> {
    let xdg = std::env::var("XDG_DOWNLOAD_DIR").ok();
    let home = std::env::var("HOME").ok();
    downloads_dir_from(xdg.as_deref(), home.as_deref())
        .ok_or_else(|| "No home directory found to save the download.".to_owned())
}

fn client(timeout: Duration, follow_redirects: bool) -> Result<reqwest::Client, String> {
    let policy = if follow_redirects {
        reqwest::redirect::Policy::limited(5)
    } else {
        reqwest::redirect::Policy::none()
    };
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout)
        .redirect(policy)
        .user_agent(format!("open-ios-studio/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("request failed: {}", e.without_url()))
}

/// The release list. The REST API allows only 60 unauthenticated requests per hour and IP, so it
/// answers 403 on shared or busy networks; then the public release feed (no such limit) is used.
async fn fetch_releases() -> Result<Vec<Release>, String> {
    match fetch_releases_api().await {
        Ok(releases) => Ok(releases),
        Err(api_err) => match fetch_latest_from_feed().await {
            Ok(release) => Ok(vec![release]),
            Err(feed_err) => Err(format!(
                "{api_err} The release feed did not work either: {feed_err}"
            )),
        },
    }
}

async fn fetch_releases_api() -> Result<Vec<Release>, String> {
    let resp = client(API_TIMEOUT, false)?
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub could not be reached: {}", e.without_url()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("GitHub answered {status} for the release list."));
    }
    resp.json::<Vec<Release>>()
        .await
        .map_err(|e| format!("release list could not be read: {}", e.without_url()))
}

/// Fallback: newest tag from `releases.atom`, assets from that release's `SHA256SUMS.txt`.
/// Neither URL goes through the rate-limited API. Sizes and the pre-release flag are not in
/// these files, so they are reported as unknown (0 / false).
async fn fetch_latest_from_feed() -> Result<Release, String> {
    let resp = client(API_TIMEOUT, true)?
        .get(RELEASES_ATOM)
        .send()
        .await
        .map_err(|e| format!("GitHub could not be reached: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub answered {} for the feed.", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if bytes.len() > MAX_FEED_BYTES {
        return Err("The release feed is unexpectedly large.".to_owned());
    }
    let xml = String::from_utf8(bytes.to_vec()).map_err(|_| "The feed is not UTF-8.".to_owned())?;
    let (tag, updated) = parse_feed_latest(&xml)
        .ok_or_else(|| "No published release was found in the feed.".to_owned())?;
    let sums = fetch_small_text(&format!("{DOWNLOAD_PREFIX}{tag}/SHA256SUMS.txt")).await?;
    Ok(release_from_sums(&tag, updated, &sums))
}

/// Newest `vX.Y.Z` release in an Atom feed: its tag and `<updated>` time. Feed entries are
/// published releases only (no drafts).
pub fn parse_feed_latest(xml: &str) -> Option<(String, Option<String>)> {
    const TAG_LINK: &str = "https://github.com/cevo1466/open-ios-studio/releases/tag/";
    xml.split("<entry>").skip(1).find_map(|entry| {
        let entry = entry.split("</entry>").next()?;
        let rest = &entry[entry.find(TAG_LINK)? + TAG_LINK.len()..];
        let tag = &rest[..rest.find('"')?];
        parse_tag(tag)?;
        let updated = entry.find("<updated>").and_then(|i| {
            let rest = &entry[i + "<updated>".len()..];
            rest.find("</updated>").map(|j| rest[..j].trim().to_owned())
        });
        Some((tag.to_owned(), updated))
    })
}

/// Builds a release from the tag and the text of its `SHA256SUMS.txt` (the assets listed there
/// plus the file itself). Names that could leave the download folder or the URL are dropped.
pub fn release_from_sums(tag: &str, published_at: Option<String>, sums: &str) -> Release {
    let url = |name: &str| format!("{DOWNLOAD_PREFIX}{tag}/{name}");
    let mut assets: Vec<ReleaseAsset> = parse_sha256sums(sums)
        .into_iter()
        .map(|(_, name)| name)
        .filter(|n| {
            n.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
                && !n.contains("..")
        })
        .map(|name| ReleaseAsset {
            browser_download_url: url(&name),
            name,
            size: 0,
        })
        .collect();
    assets.push(ReleaseAsset {
        name: "SHA256SUMS.txt".to_owned(),
        size: 0,
        browser_download_url: url("SHA256SUMS.txt"),
    });
    Release {
        tag_name: tag.to_owned(),
        draft: false,
        prerelease: false,
        published_at,
        html_url: format!("https://github.com/cevo1466/open-ios-studio/releases/tag/{tag}"),
        assets,
    }
}

/// Latest release compared with `current` (the app's own version).
pub async fn check(current: &str) -> Result<UpdateInfo, String> {
    let releases = fetch_releases().await?;
    let release =
        pick_release(&releases).ok_or_else(|| "No published release was found.".to_owned())?;
    Ok(info_from(current, release))
}

fn checked_url(url: &str) -> Result<&str, String> {
    if url.starts_with(DOWNLOAD_PREFIX) {
        Ok(url)
    } else {
        Err("Refusing to download from outside this project's GitHub releases.".to_owned())
    }
}

async fn fetch_small_text(url: &str) -> Result<String, String> {
    let resp = client(API_TIMEOUT, true)?
        .get(checked_url(url)?)
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub answered {} for {url}.", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if bytes.len() > MAX_SUMS_BYTES {
        return Err("SHA256SUMS.txt is unexpectedly large.".to_owned());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "SHA256SUMS.txt is not UTF-8.".to_owned())
}

/// Downloads the asset of `kind` from the latest release into the downloads folder, verifying
/// it against the release's `SHA256SUMS.txt`. A mismatch deletes the file and fails.
pub async fn download(kind: AssetKind) -> Result<DownloadResult, String> {
    if !matches!(kind, AssetKind::Deb | AssetKind::AppImage) {
        return Err("Only the DEB or the AppImage can be downloaded.".to_owned());
    }
    let releases = fetch_releases().await?;
    let release =
        pick_release(&releases).ok_or_else(|| "No published release was found.".to_owned())?;
    let asset = release
        .assets
        .iter()
        .find(|a| asset_kind(&a.name) == kind)
        .ok_or_else(|| "The release has no such package.".to_owned())?;
    let sums = release
        .assets
        .iter()
        .find(|a| asset_kind(&a.name) == AssetKind::Checksums)
        .ok_or_else(|| {
            "The release has no SHA256SUMS.txt, so the download cannot be verified.".to_owned()
        })?;
    if asset.size > MAX_ASSET_BYTES {
        return Err("The package is larger than the allowed download size.".to_owned());
    }
    if asset.name.contains('/') || asset.name.contains("..") {
        return Err("Unexpected asset name.".to_owned());
    }

    let expected = parse_sha256sums(&fetch_small_text(&sums.browser_download_url).await?)
        .into_iter()
        .find(|(_, name)| *name == asset.name)
        .map(|(hex, _)| hex)
        .ok_or_else(|| format!("SHA256SUMS.txt has no entry for {}.", asset.name))?;

    let dir = downloads_dir()?;
    let target = dir.join(&asset.name);
    let part = dir.join(format!("{}.part", asset.name));
    let resp = client(DOWNLOAD_TIMEOUT, true)?
        .get(checked_url(&asset.browser_download_url)?)
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GitHub answered {} for the package.",
            resp.status()
        ));
    }
    let mut file = std::fs::File::create(&part)
        .map_err(|e| format!("cannot write {}: {e}", part.display()))?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {}", e.without_url()))?;
        total += chunk.len() as u64;
        if total > MAX_ASSET_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&part);
            return Err("The download exceeded the allowed size.".to_owned());
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    let actual = hex(&hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&part);
        return Err(format!(
            "Checksum mismatch for {}: the file was deleted. Expected {expected}, got {actual}.",
            asset.name
        ));
    }
    std::fs::rename(&part, &target).map_err(|e| e.to_string())?;

    let install_command = match kind {
        AssetKind::Deb => Some(format!(
            "cd \"{}\" && sudo apt install ./{}",
            dir.display(),
            asset.name
        )),
        _ => None,
    };
    Ok(DownloadResult {
        path: target.display().to_string(),
        name: asset.name.clone(),
        sha256: actual,
        install_command,
        can_replace_running_appimage: kind == AssetKind::AppImage && running_appimage().is_some(),
    })
}

/// The running AppImage file, when the app was started from one.
pub fn running_appimage() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("APPIMAGE")?);
    (p.extension().map(|e| e == "AppImage").unwrap_or(false) && p.is_file()).then_some(p)
}

/// Replaces `target` with `downloaded` atomically (copy next to it, then rename over it).
pub fn replace_file(downloaded: &Path, target: &Path) -> Result<(), String> {
    let dir = target
        .parent()
        .ok_or_else(|| "The AppImage has no containing folder.".to_owned())?;
    let staged = dir.join(format!(
        "{}.new",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("app.AppImage")
    ));
    std::fs::copy(downloaded, &staged)
        .map_err(|e| format!("cannot copy next to the AppImage: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    std::fs::rename(&staged, target).map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        format!("cannot replace the AppImage: {e}")
    })
}

/// Replaces the running AppImage with the verified download. The checksum is recomputed from the
/// file on disk first, so a tampered file between download and apply is refused.
pub fn apply_appimage(downloaded: &Path, expected_sha256: &str) -> Result<String, String> {
    let target =
        running_appimage().ok_or_else(|| "The app was not started from an AppImage.".to_owned())?;
    if !downloaded.is_file()
        || downloaded
            .extension()
            .map(|e| e != "AppImage")
            .unwrap_or(true)
    {
        return Err("The downloaded file is not an AppImage.".to_owned());
    }
    let actual = sha256_of_file(downloaded)?;
    if actual != expected_sha256.to_ascii_lowercase() {
        return Err(
            "The downloaded file changed since it was verified; refusing to apply.".to_owned(),
        );
    }
    replace_file(downloaded, &target)?;
    Ok(target.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<feed><title>Release notes</title><updated>2026-11-03T20:11:44Z</updated>
<entry><id>x/nightly</id><updated>2026-11-04T00:00:00Z</updated>
<link rel="alternate" type="text/html" href="https://github.com/cevo1466/open-ios-studio/releases/tag/nightly"/></entry>
<entry><id>x/v0.1.11</id><updated>2026-11-03T20:22:53Z</updated>
<link rel="alternate" type="text/html" href="https://github.com/cevo1466/open-ios-studio/releases/tag/v0.1.11"/></entry>
<entry><id>x/v0.1.10</id><updated>2026-11-03T19:47:17Z</updated>
<link rel="alternate" type="text/html" href="https://github.com/cevo1466/open-ios-studio/releases/tag/v0.1.10"/></entry></feed>"#;

    #[test]
    fn feed_gives_newest_version_tag_and_its_time() {
        assert_eq!(
            parse_feed_latest(FEED),
            Some((
                "v0.1.11".to_owned(),
                Some("2026-11-03T20:22:53Z".to_owned())
            ))
        );
    }

    #[test]
    fn feed_without_a_version_tag_gives_nothing() {
        assert_eq!(parse_feed_latest("<feed></feed>"), None);
        assert_eq!(parse_feed_latest(&FEED.replace("v0.1.1", "x")), None);
    }

    #[test]
    fn feed_release_lists_assets_from_sums_and_drops_unsafe_names() {
        let h = "a".repeat(64);
        let sums = format!(
            "{h}  Open-iOS-Studio_0.1.11_amd64.deb\n{h}  *Open-iOS-Studio_0.1.11_x86_64.AppImage\n{h}  ../evil.deb\n{h}  sub/dir.deb\n"
        );
        let r = release_from_sums("v0.1.11", None, &sums);
        let names: Vec<&str> = r.assets.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Open-iOS-Studio_0.1.11_amd64.deb",
                "Open-iOS-Studio_0.1.11_x86_64.AppImage",
                "SHA256SUMS.txt"
            ]
        );
        assert!(r
            .assets
            .iter()
            .all(|a| checked_url(&a.browser_download_url).is_ok()));
        assert_eq!(info_from("0.1.10", &r).latest, "0.1.11");
        assert!(info_from("0.1.10", &r).newer);
        assert!(!info_from("0.1.11", &r).newer);
    }

    fn release(tag: &str, draft: bool, prerelease: bool) -> Release {
        Release {
            tag_name: tag.to_owned(),
            draft,
            prerelease,
            published_at: Some("2026-11-01T00:00:00Z".to_owned()),
            html_url: format!("https://github.com/cevo1466/open-ios-studio/releases/tag/{tag}"),
            assets: vec![
                ReleaseAsset {
                    name: "Open-iOS-Studio_0.1.9_amd64.deb".to_owned(),
                    size: 10,
                    browser_download_url: format!(
                        "{DOWNLOAD_PREFIX}{tag}/Open-iOS-Studio_0.1.9_amd64.deb"
                    ),
                },
                ReleaseAsset {
                    name: "SHA256SUMS.txt".to_owned(),
                    size: 1,
                    browser_download_url: format!("{DOWNLOAD_PREFIX}{tag}/SHA256SUMS.txt"),
                },
            ],
        }
    }

    #[test]
    fn tags_and_asset_kinds() {
        assert_eq!(parse_tag("v0.1.9").as_deref(), Some("0.1.9"));
        assert_eq!(parse_tag("0.2.0").as_deref(), Some("0.2.0"));
        assert_eq!(parse_tag("v1.2"), None);
        assert_eq!(parse_tag("latest"), None);
        assert_eq!(
            asset_kind("Open-iOS-Studio_0.1.9_amd64.deb"),
            AssetKind::Deb
        );
        assert_eq!(
            asset_kind("Open-iOS-Studio_0.1.9_amd64.AppImage"),
            AssetKind::AppImage
        );
        assert_eq!(asset_kind("SHA256SUMS.txt"), AssetKind::Checksums);
        assert_eq!(asset_kind("notes.md"), AssetKind::Other);
    }

    #[test]
    fn newest_non_draft_release_is_picked_prereleases_included() {
        let releases = vec![
            release("v0.3.0", true, false),
            release("nightly", false, false),
            release("v0.2.0", false, true),
            release("v0.1.9", false, true),
        ];
        assert_eq!(
            pick_release(&releases).map(|r| r.tag_name.as_str()),
            Some("v0.2.0")
        );
        assert!(pick_release(&[]).is_none());
    }

    #[test]
    fn info_compares_with_the_running_version() {
        let r = release("v0.2.0", false, true);
        let newer = info_from("0.1.9", &r);
        assert!(newer.newer);
        assert_eq!(newer.latest, "0.2.0");
        assert!(newer.prerelease);
        assert_eq!(newer.assets.len(), 2);
        assert_eq!(newer.assets[0].kind, AssetKind::Deb);
        assert!(!info_from("0.2.0", &r).newer);
        assert!(!info_from("0.2.1", &r).newer);
    }

    #[test]
    fn install_kind_detection() {
        assert_eq!(
            install_kind_from(Some("/home/u/Open.AppImage"), None),
            InstallKind::AppImage
        );
        assert_eq!(
            install_kind_from(None, Some(Path::new("/usr/bin/open-ios-studio"))),
            InstallKind::Deb
        );
        assert_eq!(
            install_kind_from(None, Some(Path::new("/home/u/dev/target/debug/app"))),
            InstallKind::Unknown
        );
        assert_eq!(
            install_kind_from(Some("/tmp/x.txt"), None),
            InstallKind::Unknown
        );
    }

    #[test]
    fn sha256sums_parsing_and_file_hash() {
        let text = "abcd\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  Open.deb\nnot a line\nABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789 *Open.AppImage\n";
        let parsed = parse_sha256sums(text);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].1, "Open.deb");
        assert_eq!(
            parsed[1],
            (
                "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".to_owned(),
                "Open.AppImage".to_owned()
            )
        );

        let dir = tempfile::tempdir().expect("tmp");
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"abc").expect("write");
        assert_eq!(
            sha256_of_file(&f).expect("hash"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn download_urls_are_pinned_to_this_repository() {
        assert!(checked_url(&format!("{DOWNLOAD_PREFIX}v0.1.9/x.deb")).is_ok());
        assert!(checked_url("https://example.com/x.deb").is_err());
        assert!(checked_url("https://github.com/other/repo/releases/download/v1/x.deb").is_err());
    }

    #[test]
    fn downloads_dir_prefers_xdg_then_home_downloads() {
        let home = tempfile::tempdir().expect("tmp");
        let home_s = home.path().to_str().expect("utf8");
        assert_eq!(
            downloads_dir_from(None, Some(home_s)).as_deref(),
            Some(home.path())
        );
        std::fs::create_dir(home.path().join("Downloads")).expect("mkdir");
        assert_eq!(
            downloads_dir_from(None, Some(home_s)).as_deref(),
            Some(home.path().join("Downloads").as_path())
        );
        let xdg = tempfile::tempdir().expect("tmp");
        assert_eq!(
            downloads_dir_from(Some(xdg.path().to_str().expect("utf8")), Some(home_s)).as_deref(),
            Some(xdg.path())
        );
        assert_eq!(
            downloads_dir_from(Some("/nope/none"), Some(home_s)).as_deref(),
            Some(home.path().join("Downloads").as_path())
        );
        assert!(downloads_dir_from(None, None).is_none());
    }

    #[test]
    fn replace_file_swaps_content_and_marks_executable() {
        let dir = tempfile::tempdir().expect("tmp");
        let target = dir.path().join("Open.AppImage");
        let fresh = dir.path().join("Open-new.AppImage");
        std::fs::write(&target, b"old").expect("write");
        std::fs::write(&fresh, b"new").expect("write");
        replace_file(&fresh, &target).expect("replace");
        assert_eq!(std::fs::read(&target).expect("read"), b"new");
        assert!(!dir.path().join("Open.AppImage.new").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                std::fs::metadata(&target)
                    .expect("meta")
                    .permissions()
                    .mode()
                    & 0o111,
                0
            );
        }
    }

    #[test]
    fn apply_refuses_without_appimage_env_or_on_hash_mismatch() {
        let dir = tempfile::tempdir().expect("tmp");
        let f = dir.path().join("x.AppImage");
        std::fs::write(&f, b"abc").expect("write");
        // Not started from an AppImage in the test process.
        std::env::remove_var("APPIMAGE");
        assert!(apply_appimage(
            &f,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        .is_err());
    }
}
