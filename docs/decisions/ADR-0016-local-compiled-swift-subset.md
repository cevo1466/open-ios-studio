# ADR-0016: independent local compiled SwiftUI subset
Status: implemented experimentally (2026-11-17, owner's master engineering prompt).

Context: The owner explicitly requests local simulation on Linux/Windows without a connected phone, remote Mac or screen mirroring. Prior project statements prohibiting simulator claims reflected an unimplemented capability, not a requirement to keep this new subsystem impossible.

Decision: Add an original source-compatible SwiftUI module and native Swift compiler/process execution. Use a JSON UI/input boundary to the Rust Engine and render locally in the existing Tauri webview. Keep this separate from physical-device xtool/signing and from any iOS binary-compatibility research. Unsupported APIs produce compiler errors; supported behavior is recorded in an evidence ledger. Remove existing UxPlay discovery and recommendations.

Consequences: The first milestone is useful for explicitly supported source and state transitions. It is not Apple's Simulator, an ARM emulator, an iOS binary loader or a complete SwiftUI implementation. Root-held State and explicit Binding are supported; nested state identity, Observable models and native iOS layout/animations remain incomplete. Each reload starts fresh state. Native Windows execution stays disabled until implemented and tested.

Verification policy: this extends ADR-0002 for source/runtime development on the now available Linux Mint Swift/Rust host. Record local checks explicitly; CI and package/desktop verification remain separate, and no existing decisions are deleted. GTK/WebKit/D-Bus development dependencies prevent a full local desktop build in this session. Never turn standalone runtime or browser success into package/Apple equivalence claims.
