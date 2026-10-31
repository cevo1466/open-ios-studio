import { MAX_MESSAGES, MAX_MESSAGE_CHARS, initialChatState, type ChatMessageView, type ChatState } from './chatState';

const PREFIX = 'open-ios-studio.chat.v1:';
export const MAX_STORED_BYTES = 1_000_000;

/** Persists messages only. Pending changes (full file contents) and streaming flags are dropped. */
export function saveConversation(workspaceKey: string, state: ChatState): void {
  try {
    const messages: ChatMessageView[] = state.messages.map((m) => {
      const out: ChatMessageView = { id: m.id, role: m.role, content: m.content };
      if (m.error) out.error = m.error;
      return out;
    });
    const build = () => JSON.stringify({ messages, usage: state.usage, nextId: state.nextId });
    let json = build();
    while (json.length > MAX_STORED_BYTES && messages.length > 0) {
      messages.shift();
      json = build();
    }
    localStorage.setItem(PREFIX + workspaceKey, json);
  } catch {
    /* storage unavailable or full: the conversation lasts for this session only */
  }
}

function validMessage(m: unknown): m is ChatMessageView {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.id === 'number' &&
    Number.isInteger(o.id) &&
    (o.role === 'user' || o.role === 'assistant' || o.role === 'system-note') &&
    typeof o.content === 'string' &&
    (o.error === undefined || typeof o.error === 'string')
  );
}

export function loadConversation(workspaceKey: string): ChatState | null {
  try {
    const raw = localStorage.getItem(PREFIX + workspaceKey);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.messages) || !o.messages.every(validMessage)) return null;
    const messages = (o.messages as ChatMessageView[]).slice(-MAX_MESSAGES).map((m) => {
      const out: ChatMessageView = { id: m.id, role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) };
      if (m.error) out.error = m.error;
      return out;
    });
    const maxId = messages.reduce((a, m) => Math.max(a, m.id), 0);
    const nextId = typeof o.nextId === 'number' && Number.isInteger(o.nextId) && o.nextId > maxId ? o.nextId : maxId + 1;
    let usage: ChatState['usage'] = null;
    if (typeof o.usage === 'object' && o.usage !== null) {
      const u = o.usage as Record<string, unknown>;
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      usage = { input: num(u.input), output: num(u.output) };
    }
    return { ...initialChatState, messages, usage, nextId };
  } catch {
    return null;
  }
}
