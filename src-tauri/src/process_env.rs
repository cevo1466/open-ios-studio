//! Explicit Windows SDK/runtime variables needed after clearing a tool's environment.
//! Credentials and arbitrary compiler flags are deliberately not inherited.
pub fn platform_pairs() -> Vec<(&'static str, std::ffi::OsString)> {
    #[cfg(windows)]
    const KEYS: &[&str] = &[
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMDATA",
        "SDKROOT",
        "DEVELOPER_DIR",
        "INCLUDE",
        "LIB",
        "LIBPATH",
        "VCINSTALLDIR",
        "VCToolsInstallDir",
        "WindowsSdkDir",
        "WindowsSDKVersion",
        "UniversalCRTSdkDir",
        "UCRTVersion",
    ];
    #[cfg(not(windows))]
    const KEYS: &[&str] = &[];
    KEYS.iter()
        .filter_map(|&key| std::env::var_os(key).map(|value| (key, value)))
        .collect()
}
