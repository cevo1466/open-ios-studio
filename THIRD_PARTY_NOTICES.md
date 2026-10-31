# Third-Party Notices

Open iOS Studio is MIT licensed (see `LICENSE`). It depends on open-source packages. This list covers the main direct dependencies and the licenses as we understand them; verify against each package before relying on it. Run `npm ls` and `cargo license` (or `cargo tree`) for the complete, authoritative list including transitive dependencies.

## JavaScript / TypeScript

| Package | License |
| --- | --- |
| react, react-dom | MIT |
| monaco-editor | MIT |
| @monaco-editor/react | MIT |
| @tauri-apps/api, @tauri-apps/cli | MIT or Apache-2.0 |
| vite, @vitejs/plugin-react | MIT |
| vitest | MIT |
| typescript | Apache-2.0 |
| eslint, typescript-eslint | MIT |
| @playwright/test | Apache-2.0 |

## Rust

| Crate | License |
| --- | --- |
| tauri, tauri-build, tauri-plugin-dialog | MIT or Apache-2.0 |
| serde, serde_json | MIT or Apache-2.0 |
| thiserror | MIT or Apache-2.0 |
| reqwest | MIT or Apache-2.0 |
| tokio | MIT |
| futures-util | MIT or Apache-2.0 |
| keyring | MIT or Apache-2.0 |
| libc | MIT or Apache-2.0 |
| tempfile (dev) | MIT or Apache-2.0 |

## Not redistributed

- Apple SDK files (Xcode, iOS SDK, Darwin SDK) are NOT included or redistributed. Users obtain them under Apple's own license terms.
- xtool binaries are NOT included or redistributed. Users install xtool themselves; its license is that of the xtool project.
- AI provider models and APIs (Anthropic, OpenAI, Ollama) are not included; use is governed by each provider's terms.

Linux packages dynamically use system libraries (for example WebKitGTK) that are installed separately under their own licenses.
