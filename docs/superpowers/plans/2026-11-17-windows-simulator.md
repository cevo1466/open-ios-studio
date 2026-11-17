# Native Windows simulator implementation

Owner explicitly requests native Windows execution after Linux integration. Implement without WSL or a remote Mac. Preserve the existing Linux runtime and physical-device workflows.

Design: use the same independently implemented SwiftUI module and JSON protocol. Compile a Windows DLL/import library and application.exe with the official Windows Swift compiler. Discover .exe tools and retain only the Windows SDK/runtime environment variables needed by the compiler. Use Windows Job Objects for compiler/runtime descendant cleanup; keep Unix process groups. Package the same runtime/example into a per-user NSIS installer. Verify using native Windows CI, including actual Swift callbacks, the installed executable and, where available, the Tauri WebView2 UI. Windows Server CI is not a Windows 11 owner-desktop certification.

- [x] Add platform process/environment support, Windows compiler arguments and executable discovery; check Windows target locally and Linux regression tests.
- [x] Add official Swift Windows setup and a native Windows CI lane; run real compiled Swift interaction tests there.
- [ ] Build/install a Windows NSIS package and verify embedded/runtime resources and compiled callback.
- [ ] Verify actual WebView2 editor/device interaction on Windows CI; report exactly what remains unverified on a real Windows 11 desktop.
- [ ] Update compatibility/install documentation and integrate after green checks. No release tag/public release without owner approval.

Primary references: https://www.swift.org/install/windows/manual/, https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects. Toolchain version pinned to official Swift 6.4.2 for reproducible CI. No Apple SDK/framework binaries are included.

Native Windows Swift integration tests and Job Object timeout/descendant test passed in run 44050715836. Its first package build then stopped at the missing Windows ICO, now generated from the existing app icon. Run 44052829418 verifies that fix. Frontend: 439 Vitest; Linux full Tauri: 129 tests, full clippy and browser simulator regression passed. Installer/UI results are not yet claimed.
