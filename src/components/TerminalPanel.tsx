import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import type { PtyKind, PtyOptions } from '../ai/types';
import { ipc } from '../ipc';
import { useThemeDef } from '../theme/ThemeContext';
import { clipboardAction, createOrderedWriter } from './terminalInput';
import '@xterm/xterm/css/xterm.css';
import '../terminal-panel.css';

export const TERMINAL_TITLES: Record<PtyKind, string> = {
  'claude-login': 'Claude girişi',
  'codex-login': 'Codex girişi',
  'user-shell': 'Terminal',
  'claude-code': 'Claude Code',
};

interface Props {
  kind: PtyKind;
  /** Model/effort for a `claude-code` session; read when the session starts. */
  options?: PtyOptions;
  /** Changing this value starts a fresh session. */
  runKey: number;
  theme: 'light' | 'dark';
  onExit(code: number | null): void;
  onClose(): void;
  /** Shown on a plain shell: starts Claude Code with the project context instead. */
  onStartClaudeCode?: { label: string; run(): void };
  /** A `claude-code` session only: what was asked for, and a warning when the settings changed since. */
  session?: { summary: string; bypass: boolean; stale: boolean; restart(): void };
}

type Phase = 'starting' | 'running' | 'exited' | 'error';

/** Puts text on the clipboard; falls back to a hidden textarea when the async API is refused. */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* WebKitGTK may refuse the async API; try the legacy path below */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } finally {
    area.remove();
  }
}


/**
 * Embedded terminal (ADR-0009). Everything typed here goes to the PTY of the session this panel
 * opened; nothing else in the app writes to it. Closing the panel kills the session.
 */
export function TerminalPanel({ kind, options, runKey, theme, onExit, onClose, onStartClaudeCode, session }: Props) {
  const colors = useThemeDef(theme).terminal;
  const host = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const termRef = useRef<Terminal | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = colors;
  }, [colors]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: colors,
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
    // One keystroke must reach the PTY as one small write (see terminalInput.ts).
    const send = createOrderedWriter((piece) => (id === null ? Promise.resolve() : ipc.ptyWrite(id, piece)));
    const input = term.onData(send);
    // Copy: xterm keeps its selection outside the DOM, so write it to the clipboard ourselves.
    // Paste: returning false stops xterm from sending ^V to the PTY, and not calling
    // preventDefault lets the WebView fire its own paste event, which xterm turns into a
    // (bracketed) paste.
    term.attachCustomKeyEventHandler((e) => {
      const action = clipboardAction(e);
      if (action === 'copy') {
        e.preventDefault();
        const selected = term.getSelection();
        if (selected) void copyToClipboard(selected);
        return false;
      }
      return action === 'paste' ? false : true;
    });
    // WebKitGTK keeps composed text (ı ş ğ …) in xterm's hidden textarea; stale content is then
    // re-sent with later keystrokes and looks like a paste. Empty it once xterm has read it.
    const ta = term.textarea;
    const clearTa = () => {
      setTimeout(() => {
        if (ta && ta.value !== '') ta.value = '';
      }, 0);
    };
    ta?.addEventListener('compositionend', clearTa);
    ta?.addEventListener('input', clearTa);
    ipc
      .ptyOpen(kind, options, term.rows, term.cols, (ev) => {
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
      ta?.removeEventListener('compositionend', clearTa);
      ta?.removeEventListener('input', clearTa);
      if (id !== null) void ipc.ptyClose(id).catch(() => undefined);
      termRef.current = null;
      term.dispose();
    };
    // `colors` is applied by its own effect; a theme change must not restart the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, runKey]);

  const label =
    phase === 'starting' ? 'başlatılıyor' : phase === 'running' ? 'çalışıyor' : phase === 'exited' ? 'bitti' : 'başlatılamadı';

  return (
    <section className="term-panel" aria-label={TERMINAL_TITLES[kind]} style={{ background: colors.background }}>
      <div className="term-head">
        <strong>{TERMINAL_TITLES[kind]}</strong>
        {kind === 'claude-code' && (
          <span className="term-role">
            Claude Code · tam ajan: dosyaları okur, komut çalıştırır,{' '}
            {session?.bypass ? <strong className="term-bypass">izin sormadan çalışıyor</strong> : 'her adımda izin sorar'}
            {session?.summary ? ` · istenen: ${session.summary}` : ''}
          </span>
        )}
        <span className="term-state" aria-live="polite">
          {label}
        </span>
        {onStartClaudeCode && (
          <button type="button" className="term-claude" onClick={onStartClaudeCode.run} title="Claude Code'u proje klasöründe, proje türünü ve xtool'u bilerek başlatır">
            {onStartClaudeCode.label}
          </button>
        )}
        <button type="button" onClick={onClose}>
          Kapat
        </button>
      </div>
      {session?.stale && (
        <p className="term-stale" role="status">
          Model, efor veya izin ayarı bu oturumdan sonra değişti. Yeni ayar için oturumu yeniden başlatın.{' '}
          <button type="button" className="tree-link" onClick={session.restart}>
            Yeni ayarla yeniden başlat
          </button>
        </p>
      )}
      {error && (
        <p className="term-error" role="alert">
          {error}
        </p>
      )}
      <div className="term-host" ref={host} />
    </section>
  );
}
