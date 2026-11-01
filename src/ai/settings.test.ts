import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAiSettings, loadAiSettings, parseAiSettings, saveAiSettings } from './settings';

function stub() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  });
  return m;
}
afterEach(() => vi.unstubAllGlobals());

describe('ai settings', () => {
  it('defaults have no hard-coded models', () => {
    expect(Object.values(defaultAiSettings.models).every((m) => m === '')).toBe(true);
    expect(parseAiSettings(null)).toEqual(defaultAiSettings);
  });
  it('falls back on bad json and wrong shapes', () => {
    expect(parseAiSettings('{nope')).toEqual(defaultAiSettings);
    expect(parseAiSettings('42')).toEqual(defaultAiSettings);
    expect(parseAiSettings(JSON.stringify({ provider: 'x', models: 5 }))).toEqual(defaultAiSettings);
  });
  it('keeps only known effort levels', () => {
    const s = parseAiSettings(JSON.stringify({ efforts: { 'claude-cli': 'high', 'codex-cli': '--evil', openai: 5 } }));
    expect(s.efforts['claude-cli']).toBe('high');
    expect(s.efforts['codex-cli']).toBe('');
    expect(s.efforts.openai).toBe('');
  });
  it('skips permission prompts by default and keeps an explicit choice', () => {
    expect(defaultAiSettings.skipPermissions).toBe(true);
    expect(parseAiSettings(JSON.stringify({ skipPermissions: false })).skipPermissions).toBe(false);
    expect(parseAiSettings(JSON.stringify({ skipPermissions: 'no' })).skipPermissions).toBe(true);
  });
  it('clamps tokens and caps notes', () => {
    expect(parseAiSettings(JSON.stringify({ maxContextTokens: 1 })).maxContextTokens).toBe(4000);
    expect(parseAiSettings(JSON.stringify({ maxContextTokens: 9e9 })).maxContextTokens).toBe(120000);
    expect(parseAiSettings(JSON.stringify({ notes: 'a'.repeat(5000) })).notes).toHaveLength(2000);
  });
  it('round-trips and never stores keys', () => {
    const m = stub();
    const s = { ...defaultAiSettings, provider: 'ollama' as const, models: { ...defaultAiSettings.models, ollama: 'm1' } };
    saveAiSettings({ ...s, apiKey: 'secret' } as typeof s);
    expect([...m.values()].join('')).not.toContain('secret');
    expect(loadAiSettings()).toEqual(s);
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
    expect(loadAiSettings()).toEqual(defaultAiSettings);
    expect(() => saveAiSettings(defaultAiSettings)).not.toThrow();
  });
});
