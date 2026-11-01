import { describe, expect, it } from 'vitest';
import { cliBadge, cliBlockedReason, isCliProvider, looksLikeApiKeyLogin } from './cli';
import type { CliStatus } from './types';

const ok: CliStatus = { installed: true, loggedIn: true, detail: 'Logged in using ChatGPT' };

describe('cli providers', () => {
  it('recognises the subscription providers only', () => {
    expect(isCliProvider('claude-cli')).toBe(true);
    expect(isCliProvider('codex-cli')).toBe(true);
    expect(isCliProvider('anthropic')).toBe(false);
    expect(isCliProvider('ollama')).toBe(false);
  });
  it('maps status to a badge', () => {
    expect(cliBadge(null)).toBe('unknown');
    expect(cliBadge({ installed: false, loggedIn: null, detail: '' })).toBe('missing');
    expect(cliBadge({ installed: true, loggedIn: false, detail: '' })).toBe('logged-out');
    expect(cliBadge({ installed: true, loggedIn: null, detail: '' })).toBe('unknown');
    expect(cliBadge(ok)).toBe('ready');
  });
  it('blocks sending until logged in', () => {
    expect(cliBlockedReason('codex-cli', ok)).toBeNull();
    expect(cliBlockedReason('codex-cli', null)).toMatch(/yenileyin/);
    expect(cliBlockedReason('claude-cli', { installed: false, loggedIn: null, detail: '' })).toMatch(/claude/);
    expect(cliBlockedReason('claude-cli', { installed: true, loggedIn: false, detail: '' })).toMatch(/giriş/);
  });
  it('flags API-key logins', () => {
    expect(looksLikeApiKeyLogin({ installed: true, loggedIn: true, detail: 'Logged in using an API key' })).toBe(true);
    expect(looksLikeApiKeyLogin(ok)).toBe(false);
  });
});
