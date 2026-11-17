# ADR-0017: native Windows execution of the local Swift subset

Status: implemented and verified on Windows Server 2022 x64 CI, 2026-11-17 (PR #59).

Context: the owner prioritizes native Windows 11 execution immediately after Linux integration. This supersedes ADR-0016's temporary Windows restriction.

Decision: compile the same original SwiftUI module as a Windows DLL/import library and the app as an EXE using official Swift. Use a restricted Windows SDK/runtime environment and Job Objects for descendant cleanup. Keep the Unix process-group path. Bundle the same source/example/guide in a per-user NSIS installer with WebView2 setup. Preserve existing editor, terminal, AI, LSP and Linux xtool workflows; describe subset support accurately in the agent context.

Evidence: [native CI run 44147603682](https://github.com/cevo1466/open-ios-studio/actions/runs/44147603682) passed actual Swift integration, process cleanup, NSIS build/install/resource/callback checks, installed WebView2 editor/device interactions, PowerShell ConPTY execution/exit, formatting, clippy and 105 full Windows Rust tests. Later revision checks are tracked in PR #59.

Consequences: Swift, Visual Studio and Windows SDK remain external prerequisites. CI's Windows Server host does not certify a real Windows 11 desktop. Windows ARM64, updater installation, physical iPhone deployment and full Apple framework/binary compatibility remain unverified or unsupported. No public release/tag is created by this integration. See [Windows guide](../WINDOWS_SIMULATOR.md).
