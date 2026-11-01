/**
 * Contract of the AI engine between the webview and the Rust side (src-tauri/src/ai.rs, secrets.rs).
 * API keys live in the OS keyring and are only read by Rust; the webview can set, delete and check
 * them but never read them. The webview names a provider, Rust builds the HTTP request.
 */

export type ProviderId = 'anthropic' | 'openai' | 'ollama' | 'claude-cli' | 'codex-cli';
export const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'ollama', 'claude-cli', 'codex-cli'];

/** Providers that run the official CLI with the user's subscription login (ADR-0008). */
export type CliProviderId = 'claude-cli' | 'codex-cli';

/** Login state reported by Rust (`cli_status`). `loggedIn` is null when it could not be determined. */
export interface CliStatus {
  installed: boolean;
  loggedIn: boolean | null;
  detail: string;
}

/** Embedded terminal session kinds (ADR-0009). Argument vectors are fixed in Rust. */
export type PtyKind = 'claude-login' | 'codex-login' | 'user-shell' | 'claude-code';

/** Choices for an interactive Claude Code session. Empty strings = CLI defaults. */
export interface PtyOptions {
  model: string;
  effort: string;
  /** Live website Claude Code may study. Handed to that one session only; never stored. */
  remote?: RemoteSite;
}

export type RemoteProtocol = 'sftp' | 'ftp' | 'ftps';

export interface RemoteSite {
  protocol: RemoteProtocol;
  host: string;
  /** 0 = default port of the protocol. */
  port: number;
  user: string;
  password: string;
}

export type PtyEvent = { kind: 'data'; text: string } | { kind: 'exit'; code: number | null };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  provider: ProviderId;
  /** Model id typed or picked by the user; never hard-coded (listed dynamically with ai_list_models). */
  model: string;
  /** Reasoning effort for the CLI providers ("low" … "max"); omitted or empty = CLI default. */
  effort?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export type AiEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done'; stopReason: string | null; inputTokens: number | null; outputTokens: number | null }
  | { kind: 'error'; message: string; status: number | null };

export interface ModelInfo {
  id: string;
}

/** Tauri commands: ai_stream(request, onEvent), ai_cancel(), ai_list_models(provider),
 *  secret_set(provider, key), secret_delete(provider), secret_status(provider) -> boolean. */

/** A file change proposed by the model. Always untrusted until validated and approved by the user. */
export interface ProposedChange {
  /** Workspace-relative path, `/` separators. */
  path: string;
  content: string;
}

export type ChangeDecision = 'pending' | 'approved' | 'rejected';
