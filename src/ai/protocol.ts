/**
 * Provider-agnostic text protocol for model file proposals. Model output is UNTRUSTED:
 * every path and size is validated here, and nothing is written without user approval.
 *
 *   <<<FILE path="Sources/App/ContentView.swift">>>
 *   ...complete new file content...
 *   <<<END FILE>>>
 */
import type { ProposedChange } from './types';

export interface ChangeLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  allowedExtensions: string[];
  /** Permit `.github/workflows/**`. Off by default. */
  allowWorkflows: boolean;
}

export const DEFAULT_LIMITS: ChangeLimits = {
  maxFiles: 40,
  maxFileBytes: 200_000,
  maxTotalBytes: 600_000,
  allowedExtensions: [
    'swift',
    'plist',
    'yml',
    'yaml',
    'json',
    'md',
    'strings',
    'entitlements',
    'xcconfig',
    'txt',
  ],
  allowWorkflows: false,
};

export interface ParseResult {
  changes: ProposedChange[];
  problems: string[];
  /** Text outside file blocks. */
  commentary: string;
}

export const END_MARKER = '<<<END FILE>>>';
const OPEN_RE = /^<<<FILE path="([^"]*)">>>[ \t]*$/;
const ALLOWED_DOTFILES = new Set(['.gitignore']);
const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Returns the normalised path, or an error string. */
export function validatePath(raw: string, limits: ChangeLimits): { path: string } | { error: string } {
  let p = raw.trim();
  if (p === '') return { error: 'empty path' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return { error: 'control character in path' };
  if (p.includes('\\')) return { error: 'backslash in path' };
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~')) return { error: 'absolute path' };
  while (p.startsWith('./')) p = p.slice(2);
  if (p === '' || p.endsWith('/')) return { error: 'empty path' };
  const segs = p.split('/');
  if (segs.some((s) => s === '')) return { error: 'empty path segment' };
  if (segs.some((s) => s === '..')) return { error: 'path traversal' };
  if (segs.some((s) => s === '.')) return { error: 'dot segment in path' };
  const lower = segs.map((s) => s.toLowerCase());
  if (lower.includes('.git')) return { error: 'git internals are off limits' };
  if (lower.includes('.build') || lower.includes('node_modules')) return { error: 'build or dependency directory' };
  if (lower[0] === '.github' && lower[1] === 'workflows' && !limits.allowWorkflows) {
    return { error: 'workflow files are not allowed' };
  }
  const base = lower[lower.length - 1] ?? '';
  if (base.startsWith('.env')) return { error: 'secret file (.env)' };
  if (/\.(pem|p12|key)$/.test(base) || base.startsWith('id_rsa')) return { error: 'secret or key file' };
  if (base === 'package.resolved') return { error: 'Package.resolved is generated' };
  if (!ALLOWED_DOTFILES.has(base)) {
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1) : '';
    if (!limits.allowedExtensions.includes(ext)) return { error: `extension not allowed${ext ? ` (.${ext})` : ''}` };
  }
  return { path: p };
}

export function parseProposedChanges(text: string, limits?: Partial<ChangeLimits>): ParseResult {
  const lim: ChangeLimits = { ...DEFAULT_LIMITS, ...limits };
  const problems: string[] = [];
  const changes: ProposedChange[] = [];
  const commentary: string[] = [];
  const seen = new Set<string>();
  let total = 0;

  const lines = text.split(/\r?\n/);
  let cur: { rawPath: string; lines: string[] } | null = null;

  const finish = (c: { rawPath: string; lines: string[] }): void => {
    const v = validatePath(c.rawPath, lim);
    const label = JSON.stringify(c.rawPath.slice(0, 120));
    if ('error' in v) {
      problems.push(`Rejected ${label}: ${v.error}`);
      return;
    }
    const key = v.path.toLowerCase();
    if (seen.has(key)) {
      problems.push(`Rejected duplicate path ${JSON.stringify(v.path)} (first one kept)`);
      return;
    }
    const content = c.lines.join('\n');
    const size = byteLength(content);
    if (size > lim.maxFileBytes) {
      problems.push(`Rejected ${JSON.stringify(v.path)}: ${size} bytes exceeds per-file limit ${lim.maxFileBytes}`);
      return;
    }
    if (changes.length >= lim.maxFiles) {
      problems.push(`Rejected ${JSON.stringify(v.path)}: more than ${lim.maxFiles} files`);
      return;
    }
    if (total + size > lim.maxTotalBytes) {
      problems.push(`Rejected ${JSON.stringify(v.path)}: total size limit ${lim.maxTotalBytes} bytes exceeded`);
      return;
    }
    seen.add(key);
    total += size;
    changes.push({ path: v.path, content });
  };

  for (const line of lines) {
    if (cur) {
      if (line === END_MARKER) {
        finish(cur);
        cur = null;
      } else {
        cur.lines.push(line);
      }
      continue;
    }
    const m = OPEN_RE.exec(line);
    if (m) {
      cur = { rawPath: m[1] ?? '', lines: [] };
      continue;
    }
    if (line.startsWith('<<<FILE') || line.startsWith('<<<END FILE') || /^<<<[A-Z_ ]+\b/.test(line)) {
      problems.push(`Ignored unknown directive: ${JSON.stringify(line.slice(0, 80))}`);
      continue;
    }
    commentary.push(line);
  }
  if (cur) {
    problems.push(`Unterminated file block for ${JSON.stringify(cur.rawPath.slice(0, 120))} (dropped)`);
  }
  return { changes, problems, commentary: commentary.join('\n').trim() };
}
