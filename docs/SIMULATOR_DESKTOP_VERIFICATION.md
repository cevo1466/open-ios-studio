# Local simulator: Mint desktop and package verification

Recorded 2026-11-17 on Linux Mint 22.3 x86_64, Swift 6.4.2, Rust 1.99.1, Node 24.22.3. Integration base: upstream `bc72cc1` (v0.1.12); prepared app version 0.2.0.

## Observed in the actual desktop window

The actual Tauri executable was built and launched on the host X11 desktop. These observations are separate from Playwright and its test IPC bridge:

1. Opened a temporary workspace `/tmp/ois-desktop-project` and `Counter.swift` in Monaco. Existing user source projects were not edited.
2. Opened **Simülatör**; the bundled-runtime/compiler-ready status appeared. Started the source and saw **Count: 0** on the local device.
3. Clicked **Increase** and saw **Count: 1**.
4. Used Monaco's go-to-line, edited the initial `@State` value to **40** and saved with Ctrl+S. Checked the saved source on disk.
5. Pressed **Yeniden derle / başlat**, saw **Count: 40**, clicked **Increase**, and saw **Count: 41**.

The native-window screenshots are retained locally in the ignored evidence directory; they are not uploaded to this repository.

The initial host development-package failure was resolved by downloading official Ubuntu development DEBs and extracting them into a temporary sysroot. The app linked against the host's installed GTK/WebKit runtime libraries. No administrator password or system package installation was used. The existing `/usr/bin/open-ios-studio` was left unchanged.

The workspace switch exposed an existing stale file-tree issue: the root listing did not rerun when only the workspace changed. The explorer now resets its root with the workspace; the browser regression test switches folders and verifies the old entries disappear.

## Package checks

`npm run tauri build -- --debug --bundles deb` produced `Open iOS Studio_0.2.0_amd64.deb`. This local artifact is a **development/debug build**, not a published release.

`python3 scripts/verify-simulator-package.py --deb <artifact> --output <report>` extracted the DEB and verified:

- Exact bytes/SHA-256 for bundled compatibility source, Counter example, guide and MIT license.
- Extracted executable reports bundle ID `open-ios-studio.local-swift.v1` and correct embedded-runtime size.
- Extracted executable compiles the embedded Swift example and its actual callback changes **Count: 0 → Count: 1**.

The runtime and example are embedded in the executable and included as readable package resources. The Swift compiler is an external prerequisite; the panel detects it. Node/Rust/development packages are not required to run the installed app. CI's DEB/AppImage package jobs run the same check on both extracted layouts, using the runner-provided Swift compiler.

## Evidence and limits

Local ignored `simulator-evidence/mint-desktop/` holds the initial, clicked, editor-rebuilt and clicked-after-edit screenshots, edited source, package verification JSON and a SHA-256 manifest. These observations record our implementation, not an Apple reference.

Verified locally: native Tauri launch and editor/compile/interaction path; extracted debug DEB resources and compiled Swift callback. Not verified by these observations: administrator/system-wide DEB installation, AppImage desktop launch, other Linux distributions, a published release, Windows, arbitrary SwiftPM/Xcode applications, iOS binaries or Apple UI fidelity. Vorbino's GoogleSignIn/Observable/UIKit/AVFoundation/StoreKit dependencies remain unsupported.

SourceKit LSP independently started against a Linux target and reported `No such module 'SwiftUI'` for the example even though the local simulator compiled it. Simulator-specific SourceKit build configuration is still needed; LSP and simulator compiler diagnostics retain separate marker owners. The local evidence retains this known LSP limitation.
