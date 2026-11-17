# Bundled local Swift simulator

Open iOS Studio includes an original SwiftUI compatibility module and a runnable Swift counter example. They are also embedded in the application binary; this resource folder is provided for inspection and learning.

Open the Studio, choose a workspace, click **Simülatör**, then **Örneği aç** and **Simülatörü başlat**.

The native Linux Swift toolchain (`swiftc`) must be installed separately. No iPhone, Mac, Apple SDK or screen mirroring is required for the documented subset. Compiler installation: https://www.swift.org/install/linux/

This is an experimental independent source-compatible subset, not Apple's Simulator or an iOS binary loader. Complete compatibility boundaries are documented in the repository's `docs/LOCAL_SIMULATOR.md`. Windows execution is not supported yet.

Package checks, without opening a window:

```sh
open-ios-studio --simulator-info
open-ios-studio --simulator-smoke-test
```

The smoke test compiles the bundled Swift app in a temporary directory and checks a real counter callback. It needs Swift and does not modify the user's project.
