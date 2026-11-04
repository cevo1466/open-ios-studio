/**
 * Fingerprint of the project state a preflight verdict applies to: SHA-256 over the sorted
 * `(path, content)` pairs of the scanned text files plus the icon header string. Files under
 * `.open-ios-studio/` are excluded so that writing the report does not make the report stale.
 */

const IGNORED_PREFIX = '.open-ios-studio/';

/** FNV-1a 64-bit as 16 hex characters. Fallback when Web Crypto is unavailable; also unit-tested. */
export function fnv1a64Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function serialize(files: { path: string; content: string }[], iconHeader: string): string {
  const kept = files.filter((f) => !f.path.startsWith(IGNORED_PREFIX)).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  let out = '';
  for (const f of kept) out += `${f.path}\0${f.content}\0`;
  return `${out}icon:${iconHeader}`;
}

async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** 64 hex characters (SHA-256), or `fnv-` + 16 hex characters when SHA-256 is unavailable. */
export async function fingerprintFiles(files: { path: string; content: string }[], iconHeader: string): Promise<string> {
  const text = serialize(files, iconHeader);
  return (await sha256Hex(text)) ?? `fnv-${fnv1a64Hex(text)}`;
}
