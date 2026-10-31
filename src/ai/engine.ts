import { loadCatalogs } from '../policy/catalog';
import { deriveCapabilities } from '../policy/manifest';
import { analyzeProject } from '../policy';
import { buildPolicyContext } from '../policy/promptContext';
import type { ProjectFile } from '../policy/types';
import type { Diagnostic } from '../xtool/types';
import type { PendingChange, PendingFinding } from './chatState';
import { buildProjectContext } from './context';
import type { AiSettings } from './settings';
import type { ProposedChange } from './types';

export interface PreparedContext {
  projectContext: string;
  policyContext: string;
  summary: string;
}

/** Project context (token-budgeted) and the policy rules that apply to this project. */
export function prepareContext(opts: {
  files: ProjectFile[];
  openPaths: string[];
  activePath: string | null;
  settings: AiSettings;
}): PreparedContext {
  const capabilities = deriveCapabilities(opts.files);
  const policyContext = buildPolicyContext({ rules: loadCatalogs(), capabilities, maxChars: 6000 });
  const ctx = buildProjectContext({
    files: opts.files,
    openPaths: opts.openPaths,
    activePath: opts.activePath,
    maxTokens: opts.settings.maxContextTokens,
    notes: opts.settings.notes,
  });
  const omitted = ctx.omittedCount > 0 ? `, ${ctx.omittedCount} not included` : '';
  return {
    projectContext: ctx.text,
    policyContext,
    summary: `${ctx.includedPaths.length} files, ~${ctx.estimatedTokens} tokens${omitted}`,
  };
}

/**
 * Run the static policy analysis over the project as it would look after the proposed changes and
 * return the FAIL/WARNING findings that point into the proposed files.
 */
export function findingsForChanges(
  existing: ProjectFile[],
  changes: ProposedChange[],
): Record<string, PendingFinding[]> {
  const merged = new Map<string, string>(existing.map((f) => [f.path, f.content]));
  for (const c of changes) merged.set(c.path, c.content);
  const files = [...merged].map(([path, content]) => ({ path, content }));
  const proposed = new Set(changes.map((c) => c.path));
  const out: Record<string, PendingFinding[]> = {};
  for (const result of analyzeProject(files).results) {
    if (result.status !== 'FAIL' && result.status !== 'WARNING') continue;
    for (const f of result.findings) {
      if (!f.file || !proposed.has(f.file)) continue;
      (out[f.file] ??= []).push({
        ruleId: result.ruleId,
        severity: result.severity,
        status: result.status,
        message: f.message,
        line: f.line,
      });
    }
  }
  return out;
}

export function toPending(
  changes: ProposedChange[],
  originals: Record<string, string | null>,
  findings: Record<string, PendingFinding[]>,
): PendingChange[] {
  return changes.map((c) => ({
    path: c.path,
    content: c.content,
    original: originals[c.path] ?? null,
    decision: 'pending',
    findings: findings[c.path] ?? [],
  }));
}

/** Why the approved changes must not be applied yet, or null. */
export function applyBlockedReason(approved: PendingChange[], dirtyPaths: string[]): string | null {
  const dirty = approved.find((c) => dirtyPaths.includes(c.path));
  if (dirty) return `${dirty.path} has unsaved edits in the editor. Save or discard them first.`;
  const critical = approved.find((c) => c.findings.some((f) => f.status === 'FAIL' && f.severity === 'critical'));
  if (critical) {
    return `${critical.path} has a critical policy finding. Reject this change or ask the AI to fix it.`;
  }
  return null;
}

/** Files that the build diagnostics point at (plus Package.swift), for the repair prompt. */
export function filesForRepair(files: ProjectFile[], diagnostics: Diagnostic[], limit = 6): ProjectFile[] {
  const chosen = new Map<string, ProjectFile>();
  for (const d of diagnostics) {
    if (!d.file) continue;
    const hit = files.find((f) => d.file === f.path || d.file!.endsWith(`/${f.path}`));
    if (hit && chosen.size < limit) chosen.set(hit.path, hit);
  }
  const pkg = files.find((f) => f.path === 'Package.swift');
  if (pkg && !chosen.has(pkg.path)) chosen.set(pkg.path, pkg);
  return [...chosen.values()];
}

export const MAX_REPAIR_ATTEMPTS = 3;
