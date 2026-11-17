# Local Swift simulator — experimental source subset

Open iOS Studio executes supported Swift application source on Linux and has a native Windows implementation with an independently implemented module named `SwiftUI`. The application runs as a native child process. Its actual callbacks emit UI trees; the IDE draws those locally and sends pointer/keyboard input back to Swift. There is no phone, AirPlay, screen streaming, Apple runtime, Darwin SDK or remote Mac dependency.

## Start from the IDE

Installed Linux DEB/AppImage and Windows NSIS packages include the simulator, example and compatibility source. See the [Windows installation and verification guide](WINDOWS_SIMULATOR.md) for its Swift/SDK prerequisites. Running supported source requires an installed host Swift compiler (`swiftc`); the panel reports whether it is available. You do not need Node, Rust, Tauri development libraries, an iPhone or an Apple SDK to use the installed simulator. Development builds additionally need Node >=22, Rust and Tauri Linux development libraries.

The actual Tauri desktop window was built and launched on Linux Mint 22.3 on 2026-11-17. The example ran in its device panel: click changed 0 → 1, editing/saving the initial value in Monaco and rebuilding produced 40, then click produced 41. The local debug DEB was extracted and its executable separately passed the resource/hash/compiled-callback checks. System-wide DEB installation, AppImage desktop launch and other distributions remain separate checks; see [desktop evidence](SIMULATOR_DESKTOP_VERIFICATION.md).

```bash
npm ci
npm run tauri dev
```

Open a workspace folder → **Simülatör** in the activity bar → **Örneği aç** → **Simülatörü başlat**. The sample is created at `SimulatorExample/Counter.swift` only if absent; an existing file is opened without overwriting it. Edit/save in Monaco, then use **Yeniden derle / başlat**, or enable **Kaydedince derle**. Unsaved editor changes are not compiled. Start/reload replaces the session and resets in-memory application state. Compile errors appear in logs and as Monaco markers; the old application stays interactive. Stop cancels compilation and terminates the session. Closing the panel or switching workspace also stops it.

The source field selects one `.swift` file; its direct sibling `.swift` files compile together (maximum 64; `Package.swift` is excluded). Include an `@main` App and WindowGroup. SwiftPM dependencies, recursive project discovery, package plugins, assets and preview macros are not supported. The second example, `examples/BindingAndTabs/Demo.swift`, demonstrates child Binding, secure input and native tab selection. Compile it in its own directory, not alongside another `@main` file.

Device profiles use **approximate** logical sizes and safe areas, not asserted hardware specifications. Rotation changes viewport dimensions; appearance changes renderer colours. Neither supplies SwiftUI Environment values yet. The status bar is simulated. The keyboard is the host keyboard. **SVG görüntüsü** exports our local UI as SVG/foreignObject, not a capture of another device; use a browser to view it. PNG export is not implemented. Profile controls do not emulate hardware or iOS services.

Swift LSP currently uses the workspace's regular Linux/xtool build configuration, separately from the local simulator compiler. Without a build-server configuration it can report `No such module 'SwiftUI'` while this supported example compiles successfully in the simulator. Such rows are labelled LSP in Problems; they do not mean the local runtime failed. Simulator-specific SourceKit build settings are not implemented yet.

## Verify the installed simulator

```bash
open-ios-studio --simulator-info
open-ios-studio --simulator-smoke-test
python3 scripts/verify-simulator-package.py --deb path/to/package.deb --appimage path/to/package.AppImage --output verification.json
```

The smoke test uses the embedded example, invokes the actual compiled Swift callback and requires `Count: 1`. It does not verify desktop launch. CI runs these checks from both extracted package layouts before uploading artifacts.

## Executable checks without the desktop libraries

The harness compiles the **same production Rust Engine, filesystem resolver and process runner**; it is not a fake simulator backend.

```bash
npm run test:simulator
npm run verify
npx tsc --project e2e/tsconfig.json --noEmit
# Install Playwright Chromium, or point to an installed Chrome:
CHROMIUM_PATH=/usr/bin/google-chrome npm run e2e:simulator
CHROMIUM_PATH=/usr/bin/google-chrome npm run e2e -- --workers=4
cargo clippy --manifest-path tools/simulator-harness/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo fmt --manifest-path tools/simulator-harness/Cargo.toml --check
```

With dependencies cached, add `--offline` to the cargo commands. CI's Ubuntu 22.04 image provides Swift and Rust; the browser job first runs the simulator harness. GitHub CI results are tracked in the integration PR.

The browser simulator test bridges only simulator IPC to a real Rust/Swift process; folder/editor services are a test fixture. It verifies clicks, rapid Unicode typing, navigation, modal presentation, native tab selection, child binding, scrolling, orientation, appearance, SVG export, source diagnostics/Monaco markers and continued operation after failed compilation. Native tests separately change callback arithmetic, test Unicode secure input and verify restart/state reset. Screenshots, SVG and the native frame transcript are under ignored `test-results/`.

## Compatibility status

All Apple reference comparisons are **Implemented but not verified against reference**, **Partial**, or **Unsupported**. Local passing tests never certify Apple equivalence.

| Capability | Status / exact scope |
| --- | --- |
| App, WindowGroup, View composition, result builder | Implemented/local verified for examples; no multiple scenes or preview macros |
| Text, Button, VStack/HStack, ScrollView/List | Implemented/local verified; layout and scrolling are browser semantics |
| State / Binding | Root-retained state and child bindings locally verified; nested view state identity is not implemented |
| TextField, SecureField, Toggle, Slider | Implemented/local verified; host keyboard and HTML input widgets |
| NavigationStack/Link | Basic push/pop locally verified; one process-global stack, no paths, nested/independent stacks or lifecycle hooks |
| TabView + integer selection Binding + tag/tabItem | Implemented/local verified; full subtree rendered, no lazy lifecycle semantics |
| Sheets / alerts | Boolean-binding presentation and close locally verified; no native iOS presentation/dismissal semantics |
| ZStack, Spacer, ProgressView | Implemented but component-specific runtime/reference coverage incomplete |
| padding/frame/font/foregroundStyle/background/cornerRadius/opacity/offset | Basic declarations implemented; no full SwiftUI layout proposals, alignment or overload coverage |
| Image(systemName:) | Explicit unsupported-symbol text placeholder; no SF Symbols or asset decoding |
| Appearance/orientation/zoom/fullscreen/SVG | Local UI controls; Swift Environment propagation, hardware traits and retina-native raster output incomplete |
| animation / gestures / accessibility | Browser semantics only; SwiftUI APIs and iOS behaviors unsupported |
| Observable models, persistence, virtual keyboard, iOS services | Unsupported |
| Native wgpu/Skia renderer, incremental builds, state-preserving reload | Deferred |
| Arbitrary Swift projects, .ipa/.app binaries | Unsupported |
| Native Windows x64 / Windows 11 | Native Swift DLL/EXE implementation and NSIS installer; Windows Swift and installed-package self-test verified. Desktop/terminal results are tracked in [the Windows guide](WINDOWS_SIMULATOR.md) and PR #59. Windows 11 owner-desktop certification is separate from Windows Server CI |
| Apple Simulator behavior / pixel parity | UNKNOWN; no authorized macOS reference was available |

Applications execute under the user's OS account; this is process isolation from IDE crashes, not an OS security sandbox. Use trusted development source. Resource limits, evidence provenance and architectural alternatives are in [the feasibility report](research/LOCAL_SIMULATOR_FEASIBILITY.md).
