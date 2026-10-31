import type { ChangeDecision } from './types';

export const MAX_MESSAGES = 200;
export const MAX_MESSAGE_CHARS = 200_000;

export interface ChatMessageView {
  id: number;
  role: 'user' | 'assistant' | 'system-note';
  content: string;
  streaming?: boolean;
  error?: string;
}

export interface PendingFinding {
  ruleId: string;
  severity: string;
  status: string;
  message: string;
  line?: number;
}

export interface PendingChange {
  path: string;
  content: string;
  original: string | null;
  decision: ChangeDecision;
  findings: PendingFinding[];
}

export interface ChatState {
  messages: ChatMessageView[];
  status: 'idle' | 'streaming' | 'error';
  pending: PendingChange[];
  usage: { input: number | null; output: number | null } | null;
  nextId: number;
}

export type ChatAction =
  | { type: 'userMessage'; text: string }
  | { type: 'note'; text: string }
  | { type: 'assistantStart' }
  | { type: 'assistantDelta'; text: string }
  | { type: 'assistantDone'; stopReason: string | null; inputTokens: number | null; outputTokens: number | null }
  | { type: 'assistantError'; message: string }
  | { type: 'cancel' }
  | { type: 'setPending'; changes: Omit<PendingChange, 'decision'>[] | PendingChange[] }
  | { type: 'decide'; path: string; decision: 'approved' | 'rejected' }
  | { type: 'decideAll'; decision: 'approved' | 'rejected' }
  | { type: 'clearPending' }
  | { type: 'appliedOne'; path: string }
  | { type: 'reset' }
  | { type: 'load'; state: ChatState };

export const initialChatState: ChatState = { messages: [], status: 'idle', pending: [], usage: null, nextId: 1 };

function push(state: ChatState, role: ChatMessageView['role'], content: string, extra: Partial<ChatMessageView> = {}): ChatState {
  const msg: ChatMessageView = { id: state.nextId, role, content: content.slice(0, MAX_MESSAGE_CHARS), ...extra };
  let messages = [...state.messages, msg];
  if (messages.length > MAX_MESSAGES) messages = messages.slice(messages.length - MAX_MESSAGES);
  return { ...state, messages, nextId: state.nextId + 1 };
}

function lastStreamingIndex(state: ChatState): number {
  for (let i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].streaming) return i;
  return -1;
}

function patchStreaming(state: ChatState, f: (m: ChatMessageView) => ChatMessageView): ChatState {
  const i = lastStreamingIndex(state);
  if (i < 0) return state;
  const messages = state.messages.slice();
  messages[i] = f(messages[i]);
  return { ...state, messages };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'userMessage':
      return push(state, 'user', action.text);
    case 'note':
      return push(state, 'system-note', action.text);
    case 'assistantStart':
      return { ...push(state, 'assistant', '', { streaming: true }), status: 'streaming', usage: null };
    case 'assistantDelta':
      return patchStreaming(state, (m) => ({ ...m, content: (m.content + action.text).slice(0, MAX_MESSAGE_CHARS) }));
    case 'assistantDone': {
      const done = patchStreaming(state, (m) => ({ ...m, streaming: false }));
      return {
        ...done,
        status: 'idle',
        usage: { input: action.inputTokens, output: action.outputTokens },
      };
    }
    case 'assistantError': {
      if (lastStreamingIndex(state) >= 0) {
        const s = patchStreaming(state, (m) => ({ ...m, streaming: false, error: action.message }));
        return { ...s, status: 'error' };
      }
      return { ...push(state, 'assistant', '', { error: action.message }), status: 'error' };
    }
    case 'cancel': {
      const s = patchStreaming(state, (m) => ({ ...m, streaming: false }));
      return { ...s, status: 'idle' };
    }
    case 'setPending':
      return {
        ...state,
        pending: action.changes.map((c) => ({
          path: c.path,
          content: c.content,
          original: c.original,
          findings: c.findings,
          decision: 'pending' as const,
        })),
      };
    case 'decide':
      return { ...state, pending: state.pending.map((c) => (c.path === action.path ? { ...c, decision: action.decision } : c)) };
    case 'decideAll':
      return { ...state, pending: state.pending.map((c) => ({ ...c, decision: action.decision })) };
    case 'clearPending':
      return { ...state, pending: [] };
    case 'appliedOne':
      return { ...state, pending: state.pending.filter((c) => c.path !== action.path) };
    case 'reset':
      return initialChatState;
    case 'load':
      return action.state;
  }
}

export function approvedChanges(state: ChatState): PendingChange[] {
  return state.pending.filter((c) => c.decision === 'approved');
}
