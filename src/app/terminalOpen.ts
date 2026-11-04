/**
 * Decides what a request to open a terminal does to the session that is already running. Pure,
 * so the rule is unit-tested: the Terminal button never kills a session, and replacing a running
 * Claude Code session is reported so the caller can ask the user first.
 */
import type { PtyKind, PtyOptions } from '../ai/types';

export interface TerminalSession {
  kind: PtyKind;
  /** Changing the key remounts the panel and starts a fresh PTY. */
  key: number;
  options?: PtyOptions;
}

export interface TerminalDecision {
  terminal: TerminalSession;
  /** The kind of a running Claude Code session this request would kill, or null. */
  replaces: PtyKind | null;
}

export function nextTerminal(current: TerminalSession | null, kind: PtyKind, options?: PtyOptions): TerminalDecision {
  // "Terminal" means "show me the terminal": whatever runs there stays.
  if (kind === 'user-shell' && current !== null) return { terminal: current, replaces: null };
  const terminal: TerminalSession = { kind, options, key: (current?.key ?? 0) + 1 };
  return { terminal, replaces: current?.kind === 'claude-code' ? 'claude-code' : null };
}
