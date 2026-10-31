import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatReducer, initialChatState, type ChatState } from './chatState';
import { loadConversation, saveConversation } from './storage';

function stub() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  });
  return m;
}
afterEach(() => vi.unstubAllGlobals());

const base = (): ChatState => {
  let s = chatReducer(initialChatState, { type: 'userMessage', text: 'hi' });
  s = chatReducer(s, { type: 'assistantStart' });
  s = chatReducer(s, { type: 'assistantDelta', text: 'yo' });
  return chatReducer(s, { type: 'setPending', changes: [{ path: 'a', content: 'SECRETFILE', original: null, findings: [] }] });
};

describe('conversation storage', () => {
  it('round-trips without pending or streaming flags', () => {
    const m = stub();
    saveConversation('w1', base());
    expect([...m.values()].join('')).not.toContain('SECRETFILE');
    const l = loadConversation('w1');
    expect(l).not.toBeNull();
    expect(l!.pending).toEqual([]);
    expect(l!.status).toBe('idle');
    expect(l!.messages.map((x) => x.content)).toEqual(['hi', 'yo']);
    expect(l!.messages.every((x) => x.streaming === undefined)).toBe(true);
    expect(l!.nextId).toBe(3);
  });
  it('isolates workspaces', () => {
    stub();
    saveConversation('a', base());
    expect(loadConversation('b')).toBeNull();
  });
  it('drops oldest messages over the size cap', () => {
    const m = stub();
    let s = initialChatState;
    for (let i = 0; i < 30; i++) s = chatReducer(s, { type: 'userMessage', text: String(i).padEnd(60_000, 'x') });
    saveConversation('w', s);
    const raw = [...m.values()][0];
    expect(raw.length).toBeLessThanOrEqual(1_000_000);
    const l = loadConversation('w')!;
    expect(l.messages.length).toBeGreaterThan(0);
    expect(l.messages.length).toBeLessThan(30);
    expect(l.messages[l.messages.length - 1].content.startsWith('29')).toBe(true);
  });
  it('rejects malformed data', () => {
    const m = stub();
    for (const bad of ['{', 'null', '{"messages":5}', '{"messages":[{"id":"x","role":"user","content":"a"}]}', '{"messages":[{"id":1,"role":"hax","content":"a"}]}']) {
      m.set('open-ios-studio.chat.v1:w', bad);
      expect(loadConversation('w')).toBeNull();
    }
  });
  it('survives throwing storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    });
    expect(loadConversation('w')).toBeNull();
    expect(() => saveConversation('w', base())).not.toThrow();
  });
});
