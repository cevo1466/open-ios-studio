/** Project context builder for prompts, bounded by an approximate token budget. */
import type { ProjectFile } from '../policy/types';
import { wrapUntrusted } from '../policy/promptContext';

export const MAX_FILE_BYTES = 100_000;
export const MAX_TREE_ENTRIES = 300;
export const MAX_NOTES_CHARS = 2000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ProjectContextOptions {
  files: ProjectFile[];
  openPaths: string[];
  activePath: string | null;
  maxTokens: number;
  notes?: string;
}

export interface ProjectContext {
  text: string;
  includedPaths: string[];
  omittedCount: number;
  estimatedTokens: number;
}

export function isSensitivePath(path: string): boolean {
  const base = (path.split('/').pop() ?? '').toLowerCase();
  return (
    base.startsWith('.env') ||
    /\.(pem|p12|key)$/.test(base) ||
    base.startsWith('id_rsa') ||
    base === 'googleservice-info.plist'
  );
}

function looksBinary(content: string): boolean {
  const sample = content.slice(0, 4000);
  if (sample.includes('\u0000')) return true;
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if ((c < 9 || (c > 13 && c < 32)) || c === 0xfffd) bad++;
  }
  return sample.length > 0 && bad / sample.length > 0.1;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function priority(path: string, ctx: { active: string | null; open: Set<string> }): number | null {
  const base = path.split('/').pop() ?? '';
  if (path === ctx.active) return 0;
  if (ctx.open.has(path)) return 1;
  if (path === 'Package.swift') return 2;
  if (path === 'xtool.yml') return 3;
  if (base === 'Info.plist') return 4;
  if (base.endsWith('.plist')) return 5;
  if (base.endsWith('.swift')) return 6;
  return null;
}

export function buildProjectContext(opts: ProjectContextOptions): ProjectContext {
  const files = [...opts.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const open = new Set(opts.openPaths);
  const parts: string[] = [];

  const notes = (opts.notes ?? '').trim();
  if (notes) {
    const capped = notes.length > MAX_NOTES_CHARS ? `${notes.slice(0, MAX_NOTES_CHARS)}\n[notes truncated]` : notes;
    parts.push(`## Project notes (written by the user)\n${capped}`);
  }

  const tree = files.slice(0, MAX_TREE_ENTRIES).map((f) => `- ${f.path}`);
  if (files.length > MAX_TREE_ENTRIES) tree.push(`… ${files.length - MAX_TREE_ENTRIES} more`);
  parts.push(`## File tree\n${tree.length ? tree.join('\n') : '(empty project)'}`);

  const withheld = files.filter((f) => isSensitivePath(f.path));
  if (withheld.length) {
    parts.push(`## Withheld files\n${withheld.map((f) => `- ${f.path} (withheld: sensitive file)`).join('\n')}`);
  }

  let text = parts.join('\n\n');
  const included: string[] = [];

  const candidates = files
    .filter((f) => !isSensitivePath(f.path))
    .map((f) => ({ f, p: priority(f.path, { active: opts.activePath, open }) }))
    .filter((x): x is { f: ProjectFile; p: number } => x.p !== null)
    .sort((a, b) => a.p - b.p || (a.f.path < b.f.path ? -1 : 1));

  const eligibleTotal = files.filter((f) => !isSensitivePath(f.path)).length;
  let stopped = false;
  const header = '\n\n## File contents';
  let headerAdded = false;

  for (const { f } of candidates) {
    if (stopped) break;
    if (byteLen(f.content) > MAX_FILE_BYTES || looksBinary(f.content)) continue;
    const label = `file ${f.path}`;
    const block = `\n\n### ${f.path}\n${wrapUntrusted(label, f.content)}`;
    const extra = headerAdded ? '' : header;
    if (estimateTokens(text + extra + block) <= opts.maxTokens) {
      text += extra + block;
      headerAdded = true;
      included.push(f.path);
      continue;
    }
    // Truncate this file to what remains, with an explicit marker, then stop.
    stopped = true;
    const marker = '\n[… truncated to fit the context budget …]';
    let room = opts.maxTokens * 4 - (text + extra).length - wrapUntrusted(label, '').length - f.path.length - 20 - marker.length;
    let placed = false;
    while (room > 200) {
      const cand = `\n\n### ${f.path}\n${wrapUntrusted(label, f.content.slice(0, room) + marker)}`;
      if (estimateTokens(text + extra + cand) <= opts.maxTokens) {
        text += extra + cand;
        included.push(f.path);
        placed = true;
        break;
      }
      room = Math.floor(room * 0.9);
    }
    if (!placed) stopped = true;
  }

  // Hard guard for pathologically small budgets (tree/notes alone too large).
  if (estimateTokens(text) > opts.maxTokens) {
    const marker = '\n[… context truncated …]';
    text = text.slice(0, Math.max(0, opts.maxTokens * 4 - marker.length)) + marker;
    text = text.slice(0, opts.maxTokens * 4);
  }

  return {
    text,
    includedPaths: included,
    omittedCount: eligibleTotal - included.length,
    estimatedTokens: estimateTokens(text),
  };
}
