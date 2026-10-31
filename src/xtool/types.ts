/**
 * Contract between the Rust xtool adapter (src-tauri/src/xtool.rs, runner.rs) and the UI.
 * The webview never passes raw argv: it names an allow-listed operation and Rust builds the command.
 */

export type XtoolOp = 'version' | 'sdk-status' | 'new' | 'build';

export interface XtoolRunArgs {
  /** `new`: package name, validated by `validateProjectName` and again in Rust. */
  name?: string;
  /** `build`: workspace-relative project directory containing Package.swift ('' = workspace root). */
  project?: string;
  /** `build`: configuration. */
  configuration?: 'debug' | 'release';
}

export type RunEvent =
  | { kind: 'line'; stream: 'stdout' | 'stderr'; text: string }
  | {
      kind: 'exit';
      /** null when killed by a signal. */
      code: number | null;
      cancelled: boolean;
      timedOut: boolean;
      /** Lines dropped because the bounded buffer was full. */
      droppedLines: number;
    };

export interface XtoolInfo {
  found: boolean;
  path: string | null;
  /** Raw `xtool --version` output (trimmed), if it ran. */
  versionOutput: string | null;
  /** Raw `swift --version` first lines, if swift is on PATH. */
  swiftVersionOutput: string | null;
  /** Why detection failed (not found, did not run, timed out). */
  error: string | null;
}

export type VersionKind = 'semver' | 'commit' | 'unknown';

export interface ParsedVersion {
  kind: VersionKind;
  /** e.g. "1.24.0" for semver, commit sha for commit builds. */
  value: string | null;
  raw: string;
}

export type Compatibility = 'tested' | 'untested' | 'unknown';

export interface Diagnostic {
  file: string | null;
  line: number | null;
  column: number | null;
  severity: 'error' | 'warning' | 'note';
  message: string;
  raw: string;
}
