/**
 * Contract of the AI engine between the webview and the Rust side (src-tauri/src/ai.rs, secrets.rs).
 * API keys live in the OS keyring and are only read by Rust; the webview can set, delete and check
 * them but never read them. The webview names a provider, Rust builds the HTTP request.
 */

export type ProviderId = 'anthropic' | 'openai' | 'ollama';
export const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'ollama'];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  provider: ProviderId;
  /** Model id typed or picked by the user; never hard-coded (listed dynamically with ai_list_models). */
  model: string;
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
