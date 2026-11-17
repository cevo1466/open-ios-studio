# Local Swift Simulator Implementation Plan

> Execution: native in this session, following the owner's supplied phased implementation directive.

**Goal:** Execute and interact with an actual compiled Swift application locally, integrated into Open iOS Studio.
**Architecture:** Swift compatibility module → executable with JSON lines → Rust process manager → React local device renderer. Compiler failure preserves the successful runtime.
**Tech Stack:** Swift 5 language mode on installed Swift 6.4.2, Rust, Tauri 2, React, TypeScript; no new product dependencies.
**Spec:** `docs/superpowers/specs/2026-11-17-local-swift-simulator-design.md` and the owner's master engineering prompt.

## Global constraints
- No physical-device dependency, mirroring or Apple proprietary components.
- Work on `feature/local-swift-simulator`; preserve existing IDE subsystems.
- No shell evaluation for compilation or application execution; bounded output, cancellation, confined source selection.
- Report local verification separately from Apple reference equivalence and platform verification.

## Review focus
- Broken Swift source must leave the previous app interactive.
- Rapid keyboard input must survive native render latency.
- Closing/changing workspace must stop old sessions and ignore late callbacks.
- Traversal and escaping symlinks must never select compiler inputs.
- Modified Swift arithmetic must change observed runtime behavior.

## Tasks
- [x] Implement `runtime/SwiftUI/SwiftUI.swift`: View/result builder, state/bindings, primitive nodes, callbacks, scene loop. Add `examples/LocalSimulator/Counter.swift`.
- [x] Implement `Engine::{start,input,stop}` and `BuildResult` in `src-tauri/src/simulator/`; register thin Tauri commands and typed frontend IPC. Validate source confinement and failure retention.
- [x] Implement `src/simulator/{types,SimulatorCanvas,SimulatorPanel,simulator.css}`; expose activity action, lifecycle controls, profiles, orientation, appearance, zoom, logs and local SVG export. Link compiler diagnostics to Monaco. Debounce rebuilds after save.
- [x] Compile/test the exact production engine through `tools/simulator-harness` when GTK is unavailable. Exercise real Swift callback arithmetic, conditional logic, Unicode input, navigation, modal state, reload and compiler failure.
- [x] Run native-backed browser integration, existing frontend tests, lint/typecheck/build/policy gates, relevant Rust tests and formatting. Collect screenshot and native transcript.
- [x] Record feasibility, evidence contract, limitations, environment and reproducible commands; update STATUS/README. Commit the reviewed local milestone.
