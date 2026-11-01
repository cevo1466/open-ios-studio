import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import type { PtyKind } from '../ai/types';
import { ipc } from '../ipc';
import '@xterm/xterm/css/xterm.css';
import '../terminal-panel.css';

export const TERMINAL_TITLES: Record<PtyKind, string> = {
  'claude-login': 'Claude girişi',
  'codex-login': 'Codex girişi',
  'user-shell': 'Terminal',
};

interface Props {
  kind: PtyKind;
  /** Changing this value starts a fresh session. */
  runKey: number;
  theme: 'light' | 'dark';
  onExit(code: number | null): void;
  onClose(): void;
}

type Phase = 'starting' | 'running' | 'exited' | 'error';

const THEMES = {
  dark: { background: '#14161a', foreground: '#e6e6e6', cursor: '#e6e6e6' },
  light: { background: '#ffffff', foreground: '#1b1b1b', cursor: '#1b1b1b', selectionBackground: '#cfe3ff' },
};

/**
 * Embedded terminal (ADR-0009). Everything typed here goes to the PTY of the session this panel
 * opened; nothing else in the app writes to it. Closing the panel kills the session.
 */
export function TerminalPanel({ kind, runKey, theme, onExit, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const termRef = useRef<Terminal | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme];
  }, [theme]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEMES[theme],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    try {
      fit.fit();
    } catch {
      /* host not measurable yet; ResizeObserver fits again */
    }

    let id: number | null = null;
    let disposed = false;
    const input = term.onData((data) => {
      if (id !== null) void ipc.ptyWrite(id, data).catch(() => undefined);
    });
    ipc
      .ptyOpen(kind, term.rows, term.cols, (ev) => {
        if (ev.kind === 'data') {
          term.write(ev.text);
        } else if (!disposed) {
          setPhase('exited');
          term.write(`\r\n[İşlem bitti${ev.code === null ? '' : ` (kod ${ev.code})`}]\r\n`);
          onExitRef.current(ev.code);
        }
      })
      .then((newId) => {
        if (disposed) {
          void ipc.ptyClose(newId).catch(() => undefined);
          return;
        }
        id = newId;
        setPhase('running');
        void ipc.ptyResize(newId, term.rows, term.cols).catch(() => undefined);
        term.focus();
      })
      .catch((e: unknown) => {
        if (disposed) return;
        setPhase('error');
        setError(String(e));
      });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (id !== null) void ipc.ptyResize(id, term.rows, term.cols).catch(() => undefined);
    });
    observer.observe(el);

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      if (id !== null) void ipc.ptyClose(id).catch(() => undefined);
      termRef.current = null;
      term.dispose();
    };
    // `theme` is applied by its own effect; a theme change must not restart the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, runKey]);

  const label =
    phase === 'starting' ? 'başlatılıyor' : phase === 'running' ? 'çalışıyor' : phase === 'exited' ? 'bitti' : 'başlatılamadı';

  return (
    <section className="term-panel" aria-label={TERMINAL_TITLES[kind]}>
      <div className="term-head">
        <strong>{TERMINAL_TITLES[kind]}</strong>
        <span className="term-state" aria-live="polite">
          {label}
        </span>
        <button type="button" onClick={onClose}>
          Kapat
        </button>
      </div>
      {error && (
        <p className="term-error" role="alert">
          {error}
        </p>
      )}
      <div className="term-host" ref={host} />
    </section>
  );
}
