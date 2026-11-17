//! Local source-compatible execution. This does not load iOS binaries or Apple frameworks.
mod engine;
mod smoke;
pub use engine::{BuildResult, Engine};
pub use smoke::smoke_test;

pub const BUNDLE_ID: &str = "open-ios-studio.local-swift.v1";
pub const SWIFT_UI_SOURCE: &str = include_str!("../../../runtime/SwiftUI/SwiftUI.swift");
pub const EXAMPLE_SOURCE: &str = include_str!("../../../examples/LocalSimulator/Counter.swift");

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInfo {
    pub bundle_id: &'static str,
    pub runtime_bytes: usize,
    pub example_bytes: usize,
    pub platform_supported: bool,
    pub compiler_path: Option<String>,
}

pub fn info(path: &std::ffi::OsStr) -> BundleInfo {
    BundleInfo {
        bundle_id: BUNDLE_ID,
        runtime_bytes: SWIFT_UI_SOURCE.len(),
        example_bytes: EXAMPLE_SOURCE.len(),
        platform_supported: cfg!(target_os = "linux"),
        compiler_path: crate::xtool::find_in_path("swiftc", path)
            .map(|p| p.to_string_lossy().into_owned()),
    }
}
