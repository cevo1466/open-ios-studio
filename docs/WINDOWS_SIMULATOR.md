# Native Windows simulator

Open iOS Studio implements native Windows execution of the same experimental SwiftUI source subset. Verification is tracked in the Windows PR and `Build and verify Windows simulator` workflow. Do not infer Windows 11 desktop verification from a Linux cross-check or Windows Server CI.

## Install prerequisites

Use Windows 11 x64. Install the official Windows Swift toolchain and its C++/Windows SDK prerequisites using [Swift's Windows instructions](https://www.swift.org/install/windows/) or [manual installation guide](https://www.swift.org/install/windows/manual/). The currently pinned CI toolchain is Swift 6.4.2. From a Windows terminal, the official commands are:

```powershell
winget install --id Microsoft.VisualStudio.2022.Community --exact --force --custom "--add Microsoft.VisualStudio.Component.Windows11SDK.22621 --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.VC.Tools.ARM64" --source winget
winget install --id Swift.Toolchain -e --source winget
```

After installing prerequisites, restart Open iOS Studio so it receives the new toolchain environment. Install the generated NSIS `.exe` package; it installs Studio and the simulator/example together for the current user. WebView2 is required; the installer can download its bootstrapper if absent. Node, npm and Rust are only needed to develop Studio itself.

Open a trusted source folder → **Simülatör** → **Örneği aç** → **Simülatörü başlat**. The panel reports compiler readiness. Edit/save in Monaco and rebuild, or enable **Kaydedince derle**. Supported Swift source executes locally as `application.exe`, linked to our independently implemented `SwiftUI.dll`; user events run the actual Swift callbacks. No WSL, iPhone or Mac is used for this path.

## Verification

The Windows workflow runs the same actual Swift state/binding/input/navigation/modal/rebuild tests as Linux, including paths with spaces and Unicode. A Windows-only process test checks that timeouts terminate descendants through a kill-on-close Job Object. It then builds and installs the NSIS package, verifies bundled resource hashes and runs the installed executable's real Swift callback self-test.

`scripts/verify-windows-desktop.mjs` launches that installed Tauri/WebView2 window, connects locally through the documented [Playwright WebView2 mechanism](https://playwright.dev/docs/webview2), selects a temporary folder through the native picker and tests Count 0 → 1, Unicode input, a Monaco edit/save/recompile and Count 40 → 41. No IPC is mocked. The local debugging port is enabled only in the test process environment, not by the app or installer.

The workflow uploads installer and JSON verification results as `open-ios-studio-windows-x86_64`. A failed or skipped check must not be described as verified. Its Windows Server 2022 x64 host provides native Windows evidence; a real Windows 11 user's install/display/input check remains separate.

Native Windows CI [run 44147603682](https://github.com/cevo1466/open-ios-studio/actions/runs/44147603682) passed the installed WebView2 interaction check, installed-package Swift callback test and native Swift harness at commit `5706eac627d59895dc2c9f683bf9a684f46a0125`. The desktop check also executed a PowerShell command and observed its zero-code exit through ConPTY. The workflow must remain green for later revisions; this result does not certify a physical Windows 11 desktop. No public release was created.

## Scope

This is source compatibility for the documented [experimental subset](LOCAL_SIMULATOR.md). It does not provide UIKit, Observable model support, GoogleSignIn, StoreKit, AVFoundation, general Xcode/SwiftPM project execution or an iOS binary loader. Vorbino remains outside this subset. Windows ARM64, signing, auto-update installation and physical iPhone build/deploy through xtool are not verified by this Windows simulator workflow.

The external Swift toolchain, Visual Studio and Windows SDK are not redistributed inside Studio. The Windows process environment passes an explicit SDK/runtime allow-list; API keys and arbitrary parent compiler flags remain excluded. Compiler and app descendants belong to Windows Job Objects; closing/killing a session terminates its owned processes. This is crash/process isolation, not an OS sandbox for untrusted source.
