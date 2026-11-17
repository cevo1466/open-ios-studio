# Independent local simulator feasibility — 2026-11-17

## Evidence and provenance

The `reverse-engineer-and-rebuild` skill was installed from `cevo1466/Reverse-Engineering/skills/reverse-engineer-and-rebuild`; its SKILL.md, target routing and fallback instructions were read. No REA CLI/MCP or authorized macOS Simulator was available. The fallback is primary documentation plus static source inspection and local compiler/process/browser observations. These are **not REA Evidence** and are **not observations of Apple's Simulator**.

Local starting repository: commit `32422e6`, taken from the owner's existing `open-ios-studio-yayin` checkout. Host: Linux Mint 22.3, x86_64, Swift 6.4.2, Rust 1.99.1. System Node 18 does not meet the project's Node >=22 requirement; checks use an available Node 24.22.3 runtime.

Primary sources consulted:
- [Swift Linux installation](https://www.swift.org/install/linux/) and [Windows installation](https://www.swift.org/install/windows/): platform toolchains exist; this alone does not supply Apple UI frameworks.
- [Apple State](https://developer.apple.com/documentation/swiftui/state) and [navigation stack](https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack): public semantic reference. Documentation is not a runtime parity test.
- [Tokamak](https://github.com/TokamakUI/Tokamak), [OpenSwiftUI](https://github.com/OpenSwiftUIProject/OpenSwiftUI): alternative open implementations, inspected as candidate projects. No upstream implementation code was copied or vendored.
- [wgpu](https://wgpu.rs/) and [Skia documentation](https://skia.org/docs/): candidate future local graphics backends.
- [LLVM Mach-O definitions](https://llvm.org/doxygen/BinaryFormat_2MachO_8h_source.html): executable format/load command research reference.

## Strategy decision (engineering inference)

| Approach | Finding | Decision |
| --- | --- | --- |
| Native Swift + independent module | Uses real Swift type checking, language operations and closure execution; requires a supported API subset | Implement now |
| SwiftSyntax / source analysis | Helps discover unsupported APIs but does not execute application logic | Future diagnostics; not the evaluator |
| Compiler IR | Preserves lowered semantics but needs an ABI/runtime/backend integration project | Defer |
| Custom declarative runtime | Small JSON tree is a stable renderer/input boundary; application logic stays Swift | Implement |
| Swift–Rust FFI | More lifetime/ABI coupling than a process protocol; a crash can threaten the IDE | JSON over pipes now |
| Skia | Rich text/path rasterization candidate, extra native build and layout work | Future renderer adapter |
| wgpu | Portable GPU primitives; still needs layout, shaping, focus and widget implementation | Future renderer adapter |
| Existing webview | Already supplies local text/layout/keyboard and software fallback paths; not iOS rendering semantics | First renderer, with explicit limits |

Swift compatibility is **source** compatibility of explicitly implemented declarations. The compiler consumes application source without regex transformation and invokes the independent module. A root application view is retained; its reference-backed State wrappers survive callbacks and UI-tree rebuilding. Arbitrary nested-view identity and Apple's dependency graph/state identity are not implemented. Binding is a get/set pair. Actions are registered by render-tree path and invoked by actual stdin events.

## Binary compatibility

Not implemented. Mach-O parsing alone does not provide an executable environment. ARM64 translation, Mach-O relocations and dynamic linking, Objective-C messaging, Swift ABI/library versions, UIKit/SwiftUI and other framework APIs, Darwin syscalls, sandbox expectations and graphics translation are separate obligations. Even same-ISA simulator binaries have platform ABI/framework dependencies. No `.ipa`/`.app` loader, decryption, signing bypass, Apple runtime or SDK redistribution is present. Prioritize compiled supported source.

## Observable contract and evidence ledger

| Input/action | Expected local contract | Verification | Apple comparison |
| --- | --- | --- | --- |
| Start sample | Native compiled process emits an actual UI tree | Rust integration + native browser test | UNKNOWN |
| Increase repeatedly | Swift arithmetic updates count; disabled toggle changes callback behavior | Rust integration + native browser test | UNKNOWN |
| Change callback to `+7`, initial count to 40 | Observed result 47 after a click | Rust integration | UNKNOWN |
| Unicode text input | Binding updates interpolated greeting | Rust integration + rapid browser typing | UNKNOWN |
| Slider to .75 | Application text becomes Level: 75 | Rust integration | UNKNOWN |
| Details / Back | Swift navigation stack changes and restores visible page | Rust integration + browser | UNKNOWN |
| Sheet / alert / Close | Swift state adds/removes modal node | Rust integration; sheet browser test | UNKNOWN |
| Bad Swift source | Compiler errors with source locations; old process remains interactive | Rust integration + browser | UNKNOWN |
| Reload | New process and fresh in-memory state | Rust integration | UNKNOWN |
| Rotate/dark/zoom | Local viewport/display configuration changes | Browser integration | UNKNOWN |
| Stop/close/workspace change | Terminate process group, clear session, reject subsequent input | Rust tests; browser stop | UNKNOWN |
| Scroll | Browser overflow scroll, not iOS physics | Renderer implementation; browser coverage listed in report | UNKNOWN |
| Local SVG capture | Download serialization of our own rendered device | Browser integration | UNKNOWN |

Executable test locations: `tools/simulator-harness/tests/runtime.rs`, production module unit tests, `e2e/simulator.spec.ts`. Browser evidence lives under ignored `test-results/`; it contains the local screenshot, SVG and native JSON transcript. No case is marked matched to Apple from a passing local test. Skill pixel/verdict helpers cannot establish a comparison without original captures and are not used to manufacture a positive verdict.

## Resource and lifecycle boundaries

Compiler jobs use the existing shell-free runner: allow-listed environment, closed stdin, process group, cancellation, 120-second deadline. At most 64 direct sibling `.swift` files, no Package.swift evaluation or package plugins. Workspace resolution blocks traversal/escaping symlinks. Applications run as the current user, **not an OS sandbox**. Runtime stdout has a 1 MiB per-line/32 MiB per-session limit; stderr forwards 200 bounded records and drains the rest. Input queue: 64 entries, 8 KiB/event. UI log: 200 records. Runtime maximum duration: one hour. Failed compilation or missing first frame preserves the old process. Stop cancels a build and kills the session group. Each build uses an independent temporary directory, cleaned on session exit.

The first version recompiles the compatibility module and sibling sources; incremental compilation and state-preserving hot reload are future work. Save-triggered builds debounce 600ms. Source errors are shown in logs and Monaco; they are not App Store compliance results.
