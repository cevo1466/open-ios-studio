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
