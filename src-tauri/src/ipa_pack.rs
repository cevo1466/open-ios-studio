//! IPA repackaging for App Store validation (pure Rust, no Tauri, no shell).
//!
//! Takes the `.ipa` produced by `xtool dev build --configuration release --ipa`
//! and makes it closer to what App Store Connect expects:
//!   * generates the iPhone icon set (opaque RGB PNGs) from a 1024 px `icon.png`
//!     and registers it in `Info.plist` (`CFBundleIcons`),
//!   * adds `PrivacyInfo.xcprivacy` when supplied,
//!   * removes the iPad-only orientation key from iPhone-only apps,
//!   * optionally sets `CFBundleVersion` and embeds a provisioning profile.
//!
//! It does NOT sign and does NOT upload, and it cannot create `Assets.car`
//! (no asset-catalog compiler on Linux). Nothing here proves App Store
//! acceptance; see docs/research for the honest status.

use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use plist::{Dictionary, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// (file stem, pixels): the iPhone icon set Apple asks for.
pub const ICON_SET: [(&str, u32); 8] = [
    ("AppIcon20x20@2x", 40),
    ("AppIcon20x20@3x", 60),
    ("AppIcon29x29@2x", 58),
    ("AppIcon29x29@3x", 87),
    ("AppIcon40x40@2x", 80),
    ("AppIcon40x40@3x", 120),
    ("AppIcon60x60@2x", 120),
    ("AppIcon60x60@3x", 180),
];
const ICON_FILE_STEMS: [&str; 4] = [
    "AppIcon20x20",
    "AppIcon29x29",
    "AppIcon40x40",
    "AppIcon60x60",
];
const MASTER_ICON: &str = "icon.png";
const PRIVACY_FILE: &str = "PrivacyInfo.xcprivacy";
const PROFILE_FILE: &str = "embedded.mobileprovision";
const IPAD_ORIENTATIONS: &str = "UISupportedInterfaceOrientations~ipad";
/// Refuse absurd archives (zip bombs): uncompressed total and entry count.
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 50_000;

#[derive(Debug, thiserror::Error)]
pub enum RepackError {
    #[error("IPA okunamadı: {0}")]
    Io(#[from] std::io::Error),
    #[error("IPA bir zip arşivi değil ya da bozuk: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Güvensiz dosya yolu arşivde: {0}")]
    UnsafePath(String),
    #[error("Arşiv çok büyük ya da çok fazla dosya içeriyor")]
    TooLarge,
    #[error("Payload/ altında tam olarak bir .app olmalı, bulunan: {0}")]
    AppCount(usize),
    #[error("{0} bulunamadı (xtool çıktısında beklenen dosya)")]
    Missing(String),
    #[error("icon.png 1024x1024 olmalı, bulunan: {0}x{1}")]
    IconSize(u32, u32),
    #[error("Görsel işlenemedi: {0}")]
    Image(#[from] image::ImageError),
    #[error("Info.plist işlenemedi: {0}")]
    Plist(#[from] plist::Error),
    #[error("Info.plist kök öğesi sözlük değil")]
    PlistRoot,
}

#[derive(Debug, Default, Clone)]
pub struct RepackOptions {
    /// Contents of `PrivacyInfo.xcprivacy` to place at the `.app` root.
    pub privacy_manifest: Option<Vec<u8>>,
    /// New `CFBundleVersion` (build number) to write.
    pub build_number: Option<String>,
    /// Raw `.mobileprovision` bytes to embed as `embedded.mobileprovision`.
    pub provisioning_profile: Option<Vec<u8>>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RepackReport {
    pub app_name: String,
    pub icons_written: Vec<String>,
    pub ipad_orientations_removed: bool,
    pub privacy_manifest_added: bool,
    pub profile_embedded: bool,
    pub build_number_set: Option<String>,
    /// Things the user should know; none of these are silently fixed.
    pub warnings: Vec<String>,
}

struct Entry {
    name: String,
    mode: Option<u32>,
    is_dir: bool,
    data: Vec<u8>,
}

/// Repackage `src` into `dst`. `dst` is replaced atomically via a temp file.
pub fn repack(src: &Path, dst: &Path, opts: &RepackOptions) -> Result<RepackReport, RepackError> {
    let bytes = std::fs::read(src)?;
    let (out, report) = repack_bytes(&bytes, opts)?;
    write_atomic(dst, &out)?;
    Ok(report)
}

pub fn repack_bytes(
    ipa: &[u8],
    opts: &RepackOptions,
) -> Result<(Vec<u8>, RepackReport), RepackError> {
    let mut entries = read_entries(ipa)?;
    let app = find_app(&entries)?;
    let prefix = format!("Payload/{app}/");
    let mut report = RepackReport {
        app_name: app.clone(),
        ..Default::default()
    };

    // 1) icons from the 1024 px master
    let master = take(&entries, &format!("{prefix}{MASTER_ICON}"))
        .ok_or_else(|| RepackError::Missing(format!("{prefix}{MASTER_ICON}")))?;
    for (stem, bytes) in make_icons(&master)? {
        let name = format!("{prefix}{stem}.png");
        put(&mut entries, name.clone(), bytes, 0o644);
        report.icons_written.push(name);
    }

    // 2) Info.plist
    let plist_name = format!("{prefix}Info.plist");
    let plist_bytes =
        take(&entries, &plist_name).ok_or_else(|| RepackError::Missing(plist_name.clone()))?;
    let mut info = Value::from_reader(Cursor::new(plist_bytes))?;
    let dict = info.as_dictionary_mut().ok_or(RepackError::PlistRoot)?;
    edit_info(dict, opts, &mut report);
    let mut buf = Vec::new();
    info.to_writer_xml(&mut buf)?;
    put(&mut entries, plist_name, buf, 0o644);

    // 3) privacy manifest
    let privacy_name = format!("{prefix}{PRIVACY_FILE}");
    match &opts.privacy_manifest {
        Some(b) => {
            put(&mut entries, privacy_name, b.clone(), 0o644);
            report.privacy_manifest_added = true;
        }
        None if take(&entries, &privacy_name).is_none() => report.warnings.push(
            "PrivacyInfo.xcprivacy yok; Apple 2024'ten beri gizlilik manifesti ister.".into(),
        ),
        None => {}
    }

    // 4) provisioning profile
    if let Some(p) = &opts.provisioning_profile {
        put(
            &mut entries,
            format!("{prefix}{PROFILE_FILE}"),
            p.clone(),
            0o644,
        );
        report.profile_embedded = true;
    }

    report.warnings.push(
        "Assets.car üretilemedi (Linux'ta derleyici yok); simge kabulü ancak App Store Connect işlemesinde görülür."
            .into(),
    );
    Ok((write_entries(&entries)?, report))
}

/// Extract `ipa` into the empty directory `dest` (every path is validated; no symlinks are
/// created). Returns the path of the single `.app` bundle. Used by the signing flow because
/// `rcodesign` signs bundle directories, not IPA files.
pub fn extract(ipa: &Path, dest: &Path) -> Result<PathBuf, RepackError> {
    let entries = read_entries(&std::fs::read(ipa)?)?;
    let app = find_app(&entries)?;
    if std::fs::read_dir(dest)?.next().is_some() {
        return Err(RepackError::UnsafePath(format!(
            "{} boş değil",
            dest.display()
        )));
    }
    for e in &entries {
        let target = dest.join(&e.name);
        if e.is_dir {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&target, &e.data)?;
        #[cfg(unix)]
        if let Some(mode) = e.mode {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode & 0o777))?;
        }
    }
    Ok(dest.join("Payload").join(app))
}

/// Zip `root/Payload` into `dst` (atomic), preserving executable bits. Symlinks are refused.
pub fn zip_payload(root: &Path, dst: &Path) -> Result<(), RepackError> {
    let mut entries = Vec::new();
    collect(root, &root.join("Payload"), &mut entries)?;
    write_atomic(dst, &write_entries(&entries)?)?;
    Ok(())
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> Result<(), RepackError> {
    let rel = |p: &Path| {
        p.strip_prefix(root)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    };
    let mut children: Vec<_> = std::fs::read_dir(dir)?.collect::<Result<_, _>>()?;
    children.sort_by_key(|c| c.file_name());
    for c in children {
        let path = c.path();
        let meta = std::fs::symlink_metadata(&path)?;
        if meta.file_type().is_symlink() {
            return Err(RepackError::UnsafePath(format!(
                "{} sembolik bağ",
                path.display()
            )));
        }
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            Some(meta.permissions().mode() & 0o777)
        };
        #[cfg(not(unix))]
        let mode = None;
        if meta.is_dir() {
            out.push(Entry {
                name: format!("{}/", rel(&path)),
                mode,
                is_dir: true,
                data: Vec::new(),
            });
            collect(root, &path, out)?;
        } else {
            out.push(Entry {
                name: rel(&path),
                mode,
                is_dir: false,
                data: std::fs::read(&path)?,
            });
        }
    }
    Ok(())
}

fn edit_info(dict: &mut Dictionary, opts: &RepackOptions, report: &mut RepackReport) {
    let files: Vec<Value> = ICON_FILE_STEMS
        .iter()
        .map(|s| Value::String((*s).into()))
        .collect();
    let mut primary = Dictionary::new();
    primary.insert("CFBundleIconFiles".into(), Value::Array(files));
    let mut icons = Dictionary::new();
    icons.insert("CFBundlePrimaryIcon".into(), Value::Dictionary(primary));
    dict.insert("CFBundleIcons".into(), Value::Dictionary(icons));

    if iphone_only(dict) && dict.remove(IPAD_ORIENTATIONS).is_some() {
        report.ipad_orientations_removed = true;
    }
    if let Some(b) = &opts.build_number {
        dict.insert("CFBundleVersion".into(), Value::String(b.clone()));
        report.build_number_set = Some(b.clone());
    }
    if !dict.contains_key("ITSAppUsesNonExemptEncryption") {
        report.warnings.push(
            "ITSAppUsesNonExemptEncryption yok; her yüklemede şifreleme sorusu çıkar.".into(),
        );
    }
}

/// No `UIDeviceFamily`, or only family 1 (iPhone) => iPhone-only.
fn iphone_only(dict: &Dictionary) -> bool {
    match dict.get("UIDeviceFamily").and_then(Value::as_array) {
        None => true,
        Some(a) => a.iter().all(|v| v.as_signed_integer() == Some(1)),
    }
}

fn make_icons(master_png: &[u8]) -> Result<Vec<(String, Vec<u8>)>, RepackError> {
    let img = image::load_from_memory(master_png)?;
    let (w, h) = (img.width(), img.height());
    if (w, h) != (1024, 1024) {
        return Err(RepackError::IconSize(w, h));
    }
    let rgb = flatten_on_white(&img);
    let mut out = Vec::with_capacity(ICON_SET.len());
    for (stem, px) in ICON_SET {
        let small = image::imageops::resize(&rgb, px, px, FilterType::Lanczos3);
        let mut buf = Vec::new();
        DynamicImage::ImageRgb8(small).write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)?;
        out.push((stem.to_string(), buf));
    }
    Ok(out)
}

/// App Store icons must have no alpha channel: composite over white.
fn flatten_on_white(img: &DynamicImage) -> RgbImage {
    let rgba = img.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = u32::from(p[3]);
        let blend = |c: u8| ((u32::from(c) * a + 255 * (255 - a)) / 255) as u8;
        out.put_pixel(x, y, Rgb([blend(p[0]), blend(p[1]), blend(p[2])]));
    }
    out
}

fn read_entries(ipa: &[u8]) -> Result<Vec<Entry>, RepackError> {
    let mut zip = ZipArchive::new(Cursor::new(ipa))?;
    if zip.len() > MAX_ENTRIES {
        return Err(RepackError::TooLarge);
    }
    let mut total = 0u64;
    let mut out = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        let raw = f.name().map(|n| n.into_owned()).unwrap_or_default();
        // zip's own `enclosed_name` silently strips `..`, so validate the raw name ourselves.
        let name = safe_name(&raw).ok_or(RepackError::UnsafePath(raw))?;
        total = total.saturating_add(f.size());
        if total > MAX_TOTAL_BYTES {
            return Err(RepackError::TooLarge);
        }
        let mut data = Vec::new();
        if !f.is_dir() {
            f.by_ref().take(MAX_TOTAL_BYTES).read_to_end(&mut data)?;
        }
        out.push(Entry {
            name,
            mode: f.unix_mode(),
            is_dir: f.is_dir(),
            data,
        });
    }
    Ok(out)
}

/// Accept only relative, forward-slash paths without `.`/`..`/empty parts, NUL or backslash.
fn safe_name(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.contains('\\') || raw.contains('\0') || raw.starts_with('/') {
        return None;
    }
    let body = raw.strip_suffix('/').unwrap_or(raw);
    if body
        .split('/')
        .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return None;
    }
    Some(raw.to_string())
}

fn find_app(entries: &[Entry]) -> Result<String, RepackError> {
    let mut apps: Vec<String> = entries
        .iter()
        .filter_map(|e| e.name.strip_prefix("Payload/"))
        .filter_map(|r| r.split('/').next())
        .filter(|d| d.ends_with(".app"))
        .map(String::from)
        .collect();
    apps.sort();
    apps.dedup();
    if apps.len() == 1 {
        Ok(apps.remove(0))
    } else {
        Err(RepackError::AppCount(apps.len()))
    }
}

fn take(entries: &[Entry], name: &str) -> Option<Vec<u8>> {
    entries
        .iter()
        .find(|e| !e.is_dir && e.name == name)
        .map(|e| e.data.clone())
}

fn put(entries: &mut Vec<Entry>, name: String, data: Vec<u8>, mode: u32) {
    if let Some(e) = entries.iter_mut().find(|e| !e.is_dir && e.name == name) {
        e.data = data;
    } else {
        entries.push(Entry {
            name,
            mode: Some(mode),
            is_dir: false,
            data,
        });
    }
}

fn write_entries(entries: &[Entry]) -> Result<Vec<u8>, RepackError> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    for e in entries {
        let mut o = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        if let Some(m) = e.mode {
            o = o.unix_permissions(m & 0o7777);
        }
        if e.is_dir {
            w.add_directory(e.name.trim_end_matches('/'), o)?;
        } else {
            w.start_file(&e.name, o)?;
            w.write_all(&e.data)?;
        }
    }
    Ok(w.finish()?.into_inner())
}

fn write_atomic(dst: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp: PathBuf = dst.to_path_buf();
    let mut name = tmp
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    tmp.set_file_name(name);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32, alpha: u8) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([200, 30, 30, alpha]));
        let mut buf = Vec::new();
        DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .unwrap();
        buf
    }

    fn info(extra: &[(&str, Value)]) -> Vec<u8> {
        let mut d = Dictionary::new();
        d.insert("CFBundleVersion".into(), Value::String("1".into()));
        d.insert(
            IPAD_ORIENTATIONS.into(),
            Value::Array(vec![Value::String("UIInterfaceOrientationPortrait".into())]),
        );
        for (k, v) in extra {
            d.insert((*k).into(), v.clone());
        }
        let mut b = Vec::new();
        Value::Dictionary(d).to_writer_xml(&mut b).unwrap();
        b
    }

    fn ipa(files: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut w = ZipWriter::new(Cursor::new(Vec::new()));
        for (n, d) in files {
            let o = SimpleFileOptions::default().unix_permissions(if n.ends_with("App") {
                0o755
            } else {
                0o644
            });
            w.start_file(*n, o).unwrap();
            w.write_all(d).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn sample(icon: Vec<u8>, extra: &[(&str, Value)]) -> Vec<u8> {
        ipa(&[
            ("Payload/App.app/App", vec![1, 2, 3]),
            ("Payload/App.app/Info.plist", info(extra)),
            ("Payload/App.app/icon.png", icon),
        ])
    }

    fn names(z: &[u8]) -> Vec<String> {
        let mut a = ZipArchive::new(Cursor::new(z)).unwrap();
        (0..a.len())
            .map(|i| a.by_index(i).unwrap().name().unwrap().to_string())
            .collect()
    }

    #[test]
    fn writes_icon_set_privacy_and_edits_plist() {
        let opts = RepackOptions {
            privacy_manifest: Some(b"<plist/>".to_vec()),
            build_number: Some("7".into()),
            provisioning_profile: Some(b"PROFILE".to_vec()),
        };
        let (out, r) = repack_bytes(&sample(png(1024, 1024, 255), &[]), &opts).unwrap();
        assert_eq!(r.icons_written.len(), 8);
        assert!(r.ipad_orientations_removed && r.privacy_manifest_added && r.profile_embedded);
        assert_eq!(r.build_number_set.as_deref(), Some("7"));
        let n = names(&out);
        for want in [
            "Payload/App.app/AppIcon60x60@3x.png",
            "Payload/App.app/PrivacyInfo.xcprivacy",
            "Payload/App.app/embedded.mobileprovision",
        ] {
            assert!(n.contains(&want.to_string()), "{want} eksik: {n:?}");
        }
        let mut a = ZipArchive::new(Cursor::new(&out)).unwrap();
        let mut plist_bytes = Vec::new();
        a.by_name("Payload/App.app/Info.plist")
            .unwrap()
            .read_to_end(&mut plist_bytes)
            .unwrap();
        let v = Value::from_reader(Cursor::new(plist_bytes)).unwrap();
        let d = v.as_dictionary().unwrap();
        assert!(d.contains_key("CFBundleIcons") && !d.contains_key(IPAD_ORIENTATIONS));
        assert_eq!(
            d.get("CFBundleVersion").and_then(Value::as_string),
            Some("7")
        );
    }

    #[test]
    fn icons_have_no_alpha_and_right_size() {
        let (out, _) =
            repack_bytes(&sample(png(1024, 1024, 0), &[]), &RepackOptions::default()).unwrap();
        let mut a = ZipArchive::new(Cursor::new(&out)).unwrap();
        let mut b = Vec::new();
        a.by_name("Payload/App.app/AppIcon29x29@3x.png")
            .unwrap()
            .read_to_end(&mut b)
            .unwrap();
        let img = image::load_from_memory(&b).unwrap();
        assert_eq!((img.width(), img.height()), (87, 87));
        assert!(!img.color().has_alpha());
        assert_eq!(img.to_rgb8().get_pixel(5, 5).0, [255, 255, 255]); // transparent -> white
    }

    #[test]
    fn keeps_ipad_key_for_universal_apps() {
        let extra = [(
            "UIDeviceFamily",
            Value::Array(vec![Value::Integer(1.into()), Value::Integer(2.into())]),
        )];
        let (_, r) = repack_bytes(
            &sample(png(1024, 1024, 255), &extra),
            &RepackOptions::default(),
        )
        .unwrap();
        assert!(!r.ipad_orientations_removed);
    }

    #[test]
    fn warns_about_missing_privacy_and_encryption_flag() {
        let (_, r) = repack_bytes(
            &sample(png(1024, 1024, 255), &[]),
            &RepackOptions::default(),
        )
        .unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("PrivacyInfo")));
        assert!(r
            .warnings
            .iter()
            .any(|w| w.contains("ITSAppUsesNonExemptEncryption")));
        assert!(r.warnings.iter().any(|w| w.contains("Assets.car")));
    }

    #[test]
    fn rejects_wrong_icon_size_and_bad_layouts() {
        assert!(matches!(
            repack_bytes(&sample(png(512, 512, 255), &[]), &RepackOptions::default()),
            Err(RepackError::IconSize(512, 512))
        ));
        let two = ipa(&[("Payload/A.app/x", vec![]), ("Payload/B.app/x", vec![])]);
        assert!(matches!(
            repack_bytes(&two, &RepackOptions::default()),
            Err(RepackError::AppCount(2))
        ));
        let none = ipa(&[("Payload/App.app/Info.plist", info(&[]))]);
        assert!(matches!(
            repack_bytes(&none, &RepackOptions::default()),
            Err(RepackError::Missing(_))
        ));
        assert!(repack_bytes(b"not a zip", &RepackOptions::default()).is_err());
    }

    #[test]
    fn rejects_zip_slip_paths() {
        let evil = ipa(&[("Payload/App.app/../../evil", vec![1])]);
        assert!(matches!(
            repack_bytes(&evil, &RepackOptions::default()),
            Err(RepackError::UnsafePath(_))
        ));
    }

    #[test]
    fn preserves_executable_bit_and_file_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let (src, dst) = (dir.path().join("in.ipa"), dir.path().join("out.ipa"));
        let data = ipa(&[
            ("Payload/App.app/App", vec![9]),
            ("Payload/App.app/Info.plist", info(&[])),
            ("Payload/App.app/icon.png", png(1024, 1024, 255)),
        ]);
        std::fs::write(&src, data).unwrap();
        repack(&src, &dst, &RepackOptions::default()).unwrap();
        let mut a = ZipArchive::new(std::fs::File::open(&dst).unwrap()).unwrap();
        assert_eq!(
            a.by_name("Payload/App.app/App")
                .unwrap()
                .unix_mode()
                .map(|m| m & 0o777),
            Some(0o755)
        );
        assert!(!dir.path().join("out.ipa.tmp").exists());
    }

    #[test]
    fn extract_then_zip_roundtrips_and_refuses_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("in.ipa");
        std::fs::write(&src, sample(png(1024, 1024, 255), &[])).unwrap();
        let out = dir.path().join("w");
        std::fs::create_dir(&out).unwrap();
        let app = extract(&src, &out).unwrap();
        assert!(app.ends_with("Payload/App.app") && app.join("Info.plist").is_file());
        assert!(
            extract(&src, &out).is_err(),
            "non-empty dest must be refused"
        );
        let rezip = dir.path().join("re.ipa");
        zip_payload(&out, &rezip).unwrap();
        let n = names(&std::fs::read(&rezip).unwrap());
        assert!(
            n.contains(&"Payload/App.app/Info.plist".to_string()),
            "{n:?}"
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", app.join("link")).unwrap();
            assert!(matches!(
                zip_payload(&out, &rezip),
                Err(RepackError::UnsafePath(_))
            ));
        }
    }
}
