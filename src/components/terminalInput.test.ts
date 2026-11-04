import { describe, expect, it } from 'vitest';
import { clipboardAction, createOrderedWriter, splitTerminalInput } from './terminalInput';

describe('splitTerminalInput', () => {
  it('sends Turkish letters one code point at a time', () => {
    expect(splitTerminalInput('ı')).toEqual(['ı']);
    expect(splitTerminalInput('çğıöşü')).toEqual(['ç', 'ğ', 'ı', 'ö', 'ş', 'ü']);
    expect(splitTerminalInput('İş')).toEqual(['İ', 'ş']);
  });

  it('keeps astral characters whole', () => {
    expect(splitTerminalInput('a😀')).toEqual(['a', '😀']);
  });

  it('keeps escape sequences and bracketed paste intact', () => {
    expect(splitTerminalInput('\u001b[A')).toEqual(['\u001b[A']);
    const paste = '\u001b[200~merhaba dünya\u001b[201~';
    expect(splitTerminalInput(paste)).toEqual([paste]);
  });

  it('returns nothing for empty input', () => {
    expect(splitTerminalInput('')).toEqual([]);
  });
});

describe('createOrderedWriter', () => {
  it('writes pieces in order even when an earlier write is slower', async () => {
    const seen: string[] = [];
    const write = createOrderedWriter(
      (piece) => new Promise<void>((resolve) => setTimeout(() => (seen.push(piece), resolve()), piece === 'ı' ? 15 : 1)),
    );
    write('ıa');
    write('şb');
    await new Promise((r) => setTimeout(r, 80));
    expect(seen).toEqual(['ı', 'a', 'ş', 'b']);
  });

  it('keeps going after a failed write', async () => {
    const seen: string[] = [];
    const write = createOrderedWriter((piece) => (piece === 'a' ? Promise.reject(new Error('x')) : Promise.resolve(seen.push(piece))));
    write('abc');
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(['b', 'c']);
  });
});

describe('clipboardAction', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}, type = 'keydown') => ({
    type,
    key: k,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });

  it('copies on Ctrl+Shift+C and Ctrl+Insert', () => {
    expect(clipboardAction(key('C', { ctrlKey: true, shiftKey: true }))).toBe('copy');
    expect(clipboardAction(key('Insert', { ctrlKey: true }))).toBe('copy');
  });

  it('pastes on Ctrl+V, Ctrl+Shift+V and Shift+Insert', () => {
    expect(clipboardAction(key('v', { ctrlKey: true }))).toBe('paste');
    expect(clipboardAction(key('V', { ctrlKey: true, shiftKey: true }))).toBe('paste');
    expect(clipboardAction(key('Insert', { shiftKey: true }))).toBe('paste');
  });

  it('leaves Ctrl+C alone so it still interrupts the program', () => {
    expect(clipboardAction(key('c', { ctrlKey: true }))).toBeNull();
  });

  it('ignores ordinary keys, key releases, Alt and Meta combinations', () => {
    expect(clipboardAction(key('v'))).toBeNull();
    expect(clipboardAction(key('v', { ctrlKey: true }, 'keyup'))).toBeNull();
    expect(clipboardAction(key('v', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(clipboardAction(key('c', { ctrlKey: true, shiftKey: true, metaKey: true }))).toBeNull();
  });
});
