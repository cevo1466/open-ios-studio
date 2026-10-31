import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  approvedChanges,
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatState,
} from './chatState';

const run = (actions: ChatAction[], s: ChatState = initialChatState) => actions.reduce(chatReducer, s);
const ch = (path: string) => ({ path, content: 'c', original: null, findings: [] });

describe('chatReducer', () => {
  it('adds user messages with increasing ids', () => {
    const s = run([{ type: 'userMessage', text: 'a' }, { type: 'userMessage', text: 'b' }]);
    expect(s.messages.map((m) => m.id)).toEqual([1, 2]);
    expect(s.nextId).toBe(3);
  });
  it('streams and concatenates deltas', () => {
    const s = run([{ type: 'assistantStart' }, { type: 'assistantDelta', text: 'He' }, { type: 'assistantDelta', text: 'llo' }]);
    expect(s.status).toBe('streaming');
    expect(s.messages[0]).toMatchObject({ role: 'assistant', content: 'Hello', streaming: true });
  });
  it('done finalizes and records usage', () => {
    const s = run([
      { type: 'assistantStart' },
      { type: 'assistantDone', stopReason: 'end', inputTokens: 5, outputTokens: null },
    ]);
    expect(s.status).toBe('idle');
    expect(s.messages[0].streaming).toBe(false);
    expect(s.usage).toEqual({ input: 5, output: null });
  });
  it('error marks the streaming message, or adds one', () => {
    const a = run([{ type: 'assistantStart' }, { type: 'assistantDelta', text: 'x' }, { type: 'assistantError', message: 'boom' }]);
    expect(a.status).toBe('error');
    expect(a.messages[0]).toMatchObject({ content: 'x', error: 'boom', streaming: false });
    const b = run([{ type: 'assistantError', message: 'e' }]);
    expect(b.messages[0].error).toBe('e');
  });
  it('cancel stops streaming and goes idle', () => {
    const s = run([{ type: 'assistantStart' }, { type: 'assistantDelta', text: 'p' }, { type: 'cancel' }]);
    expect(s.status).toBe('idle');
    expect(s.messages[0]).toMatchObject({ content: 'p', streaming: false });
  });
  it('ignores deltas without a streaming message', () => {
    const s = run([{ type: 'assistantDelta', text: 'x' }]);
    expect(s).toEqual(initialChatState);
  });
  it('drops the oldest messages beyond the cap', () => {
    let s = initialChatState;
    for (let i = 0; i < MAX_MESSAGES + 5; i++) s = chatReducer(s, { type: 'userMessage', text: String(i) });
    expect(s.messages).toHaveLength(MAX_MESSAGES);
    expect(s.messages[0].content).toBe('5');
  });
  it('caps message size', () => {
    const s = run([
      { type: 'assistantStart' },
      { type: 'assistantDelta', text: 'a'.repeat(MAX_MESSAGE_CHARS) },
      { type: 'assistantDelta', text: 'b' },
    ]);
    expect(s.messages[0].content).toHaveLength(MAX_MESSAGE_CHARS);
    expect(chatReducer(initialChatState, { type: 'userMessage', text: 'z'.repeat(MAX_MESSAGE_CHARS + 9) }).messages[0].content).toHaveLength(
      MAX_MESSAGE_CHARS,
    );
  });
  it('handles pending decisions', () => {
    let s = run([{ type: 'setPending', changes: [ch('a'), ch('b')] }]);
    expect(s.pending.every((c) => c.decision === 'pending')).toBe(true);
    expect(approvedChanges(s)).toEqual([]);
    s = chatReducer(s, { type: 'decide', path: 'a', decision: 'approved' });
    expect(approvedChanges(s).map((c) => c.path)).toEqual(['a']);
    s = chatReducer(s, { type: 'decideAll', decision: 'rejected' });
    expect(approvedChanges(s)).toEqual([]);
    expect(s.pending.every((c) => c.decision === 'rejected')).toBe(true);
    s = chatReducer(s, { type: 'decideAll', decision: 'approved' });
    expect(approvedChanges(s)).toHaveLength(2);
  });
  it('appliedOne removes only that change; clearPending removes all', () => {
    let s = run([{ type: 'setPending', changes: [ch('a'), ch('b')] }, { type: 'appliedOne', path: 'a' }]);
    expect(s.pending.map((c) => c.path)).toEqual(['b']);
    s = chatReducer(s, { type: 'clearPending' });
    expect(s.pending).toEqual([]);
  });
  it('reset and load', () => {
    const s = run([{ type: 'userMessage', text: 'a' }]);
    expect(chatReducer(s, { type: 'reset' })).toEqual(initialChatState);
    expect(chatReducer(initialChatState, { type: 'load', state: s })).toBe(s);
  });
});
