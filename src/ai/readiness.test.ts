import { describe, expect, it } from 'vitest';
import { sendBlockedReason, sessionState, type Readiness } from './readiness';

const base: Readiness = { provider: 'anthropic', model: 'm', keyStored: true, cliStatus: null, hasWorkspace: true, streaming: false };

describe('sendBlockedReason', () => {
  it('is null when everything is set', () => expect(sendBlockedReason(base)).toBeNull());
  it('asks for a folder, model and key in order', () => {
    expect(sendBlockedReason({ ...base, hasWorkspace: false })).toMatch(/klasör/);
    expect(sendBlockedReason({ ...base, model: ' ' })).toMatch(/model/);
    expect(sendBlockedReason({ ...base, keyStored: false })).toMatch(/anahtar/);
    expect(sendBlockedReason({ ...base, streaming: true })).toMatch(/zaten/);
  });
  it('does not need a model for CLI providers but needs a login', () => {
    const cli = { ...base, provider: 'claude-cli' as const, model: '' };
    expect(sendBlockedReason(cli)).toMatch(/yenileyin/);
    expect(sendBlockedReason({ ...cli, cliStatus: { installed: true, loggedIn: true, detail: '' } })).toBeNull();
  });
});

describe('sessionState', () => {
  it('maps providers to a short label and tone', () => {
    expect(sessionState({ provider: 'ollama', keyStored: null, cliStatus: null }).tone).toBe('ok');
    expect(sessionState({ provider: 'openai', keyStored: false, cliStatus: null })).toEqual({ label: 'anahtar yok', tone: 'warn' });
    expect(sessionState({ provider: 'codex-cli', keyStored: null, cliStatus: { installed: true, loggedIn: true, detail: '' } })).toEqual({ label: 'giriş yapıldı', tone: 'ok' });
    expect(sessionState({ provider: 'codex-cli', keyStored: null, cliStatus: null }).tone).toBe('unknown');
  });
});
