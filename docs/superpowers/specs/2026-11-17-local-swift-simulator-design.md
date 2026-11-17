# Local Swift simulator: first executable milestone

The owner's supplied master engineering prompt is the implementation specification. This design records the scoped implementation decision; the broader objective remains a cross-platform, independently implemented iOS-compatible environment.

Compile Swift source against an original, small `SwiftUI` module. Keep the executable alive, receive input on stdin, run its Swift callbacks, and emit JSON UI trees on stdout. A Rust Engine owns compiler jobs and the isolated application process. React renders that tree inside a virtual device panel in the existing IDE. No source-to-HTML parser, device mirroring, remote display, Apple binary, package plugin, or network service is involved.

Alternatives evaluated: SwiftSyntax/IR analysis requires interpreting or reimplementing Swift evaluation; direct compilation keeps actual language behavior and compiler diagnostics. Tokamak and OpenSwiftUI are research references, not dependencies or copied implementations. Skia/wgpu remain appropriate future renderer candidates; the first milestone uses the existing Tauri webview for local layout, text and input. That choice does not establish native iOS graphics or layout parity.

The first contract covers root-held `@State`, `@Binding` controls, counters with arbitrary callback arithmetic, text input, basic stack navigation, sheets and alerts. Compilation failure retains the old application. Reload restarts state. Direct sibling Swift files compile together; SwiftPM dependencies and arbitrary application packages are outside this milestone.

All reference comparisons against Apple Simulator remain UNKNOWN without an authorized macOS reference. Linux native Swift execution must be tested; the full desktop shell and Windows must be reported separately. Device profiles and safe areas are labeled approximate. Unsupported Swift APIs fail compilation. Existing Monaco, AI, terminal, policy, signing and xtool flows stay available.
