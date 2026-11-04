/** Events relayed from the Rust session (`src-tauri/src/lsp.rs`, `LspEvent`). */
export type LspEvent =
  | { kind: "message"; json: string }
  | { kind: "exit"; code: number | null }
  | { kind: "error"; message: string };

export interface LspStarted {
  id: number;
  program: string;
  /** The workspace root has `.bsp/xtool.json`, so the server builds for the iOS target. */
  bsp: boolean;
}
