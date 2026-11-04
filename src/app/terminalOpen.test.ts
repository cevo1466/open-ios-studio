import { describe, expect, it } from 'vitest';
import { nextTerminal, type TerminalSession } from './terminalOpen';

const claude: TerminalSession = { kind: 'claude-code', key: 3, options: { model: 'sonnet', effort: 'high' } };
const shell: TerminalSession = { kind: 'user-shell', key: 2 };

describe('nextTerminal', () => {
  it('opens a shell when nothing is running', () => {
    expect(nextTerminal(null, 'user-shell')).toEqual({ terminal: { kind: 'user-shell', options: undefined, key: 1 }, replaces: null });
  });

  it('the Terminal button never kills a running session: it only brings the panel forward', () => {
    expect(nextTerminal(claude, 'user-shell')).toEqual({ terminal: claude, replaces: null });
    expect(nextTerminal(shell, 'user-shell')).toEqual({ terminal: shell, replaces: null });
  });

  it('a new Claude Code session over a plain shell starts fresh without a warning', () => {
    expect(nextTerminal(shell, 'claude-code', { model: 'opus', effort: 'high' })).toEqual({ terminal: { kind: 'claude-code', options: { model: 'opus', effort: 'high' }, key: 3 }, replaces: null });
  });

  it('replacing a running Claude Code session is reported so the caller can ask first', () => {
    expect(nextTerminal(claude, 'claude-code', { model: 'opus', effort: 'high' })).toEqual({ terminal: { kind: 'claude-code', options: { model: 'opus', effort: 'high' }, key: 4 }, replaces: 'claude-code' });
    expect(nextTerminal(claude, 'claude-login')).toEqual({ terminal: { kind: 'claude-login', options: undefined, key: 4 }, replaces: 'claude-code' });
  });
});
