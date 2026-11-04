/**
 * Splits what xterm hands to `onData` into the pieces that are written to the PTY.
 *
 * Claude Code treats several characters arriving in one read as a paste ("[Pasted text]"). With
 * IME / dead-key / compose input (Turkish ı ş ğ ü ö ç) the WebView can deliver a typed letter
 * together with neighbouring text in one `onData` chunk, so a keystroke looked like a paste.
 * Plain text is therefore sent one code point at a time. Anything containing an escape (cursor
 * keys, bracketed paste `ESC[200~ … ESC[201~`) stays whole so real pastes and key sequences are
 * not torn apart.
 */
export function splitTerminalInput(data: string): string[] {
  if (data.length === 0) return [];
  if (data.includes('\u001b')) return [data];
  return Array.from(data);
}

/** Writes pieces strictly in order: each write starts after the previous one finished. */
export function createOrderedWriter(write: (piece: string) => Promise<unknown>): (data: string) => void {
  let tail: Promise<unknown> = Promise.resolve();
  return (data) => {
    for (const piece of splitTerminalInput(data)) {
      tail = tail.then(() => write(piece)).catch(() => undefined);
    }
  };
}

export type ClipboardAction = 'copy' | 'paste';

/**
 * Which clipboard action a key press asks for in the terminal, or null when it is an ordinary key.
 * Plain Ctrl+C stays an interrupt for the program in the PTY; copying needs Ctrl+Shift+C (or
 * Ctrl+Insert). xterm would otherwise send Ctrl+V to the PTY as a literal ^V and never paste, so
 * Ctrl+V, Ctrl+Shift+V and Shift+Insert are treated as paste.
 */
export function clipboardAction(e: {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): ClipboardAction | null {
  if (e.type !== 'keydown' || e.altKey || e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && key === 'c') return 'copy';
  if (e.ctrlKey && !e.shiftKey && key === 'insert') return 'copy';
  if (e.ctrlKey && key === 'v') return 'paste';
  if (e.shiftKey && !e.ctrlKey && key === 'insert') return 'paste';
  return null;
}
