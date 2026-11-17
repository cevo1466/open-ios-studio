# Bundled local Swift simulator

Open iOS Studio includes an original SwiftUI compatibility module and a runnable Swift counter example. They are also embedded in the application binary; this resource folder is provided for inspection and learning.

Open the Studio, choose a workspace, click **Simülatör**, then **Örneği aç** and **Simülatörü başlat**.

The native Swift toolchain (`swiftc`) must be installed separately on Linux or Windows. Windows additionally needs the C++ build tools and Windows SDK listed in the official Swift guide. No iPhone, Mac, Apple SDK or screen mirroring is required for the documented subset. Compiler installation: https://www.swift.org/install/

This is an experimental independent source-compatible subset, not Apple's Simulator or an iOS binary loader. Complete compatibility boundaries are documented in the repository's `docs/LOCAL_SIMULATOR.md`. Windows-native verification and installation details are in `docs/WINDOWS_SIMULATOR.md`; do not infer real Windows 11 desktop certification from CI.

Package checks, without opening a window:

```sh
open-ios-studio --simulator-info
open-ios-studio --simulator-smoke-test
```

The smoke test compiles the bundled Swift app in a temporary directory and checks a real counter callback. It needs Swift and does not modify the user's project.
