import type { Compatibility, Diagnostic, ParsedVersion } from './types';

// eslint-disable-next-line no-control-regex
const ANSI_RE =/\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const SEMVER_LINE = /^xtool\s+v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/;
const COMMIT_LINE = /^(?:xtool\s+)?commit\s+([0-9a-f]{40})(?:\s|$)/i;

export function parseXtoolVersion(output: string): ParsedVersion {
  const raw = typeof output === 'string' ? output : '';
  try {
    for (const l of stripAnsi(raw).split(/\r?\n/)) {
      const line = l.trim();
      const s = SEMVER_LINE.exec(line);
      if (s) return { kind: 'semver', value: s[1] ?? null, raw };
      const c = COMMIT_LINE.exec(line);
      if (c) return { kind: 'commit', value: (c[1] ?? '').toLowerCase(), raw };
    }
  } catch {
    // fall through
  }
  return { kind: 'unknown', value: null, raw };
}

export const TESTED_XTOOL_RANGE = { major: 1, minor: 24 } as const;

export function compatibility(v: ParsedVersion): Compatibility {
  if (v.kind === 'unknown') return 'unknown';
  if (v.kind === 'commit' || v.value === null) return 'untested';
  const m = /^(\d+)\.(\d+)\./.exec(v.value);
  if (!m) return 'untested';
  return Number(m[1]) === TESTED_XTOOL_RANGE.major && Number(m[2]) === TESTED_XTOOL_RANGE.minor
    ? 'tested'
    : 'untested';
}

export function parseSwiftVersion(output: string): string | null {
  const m = /Swift version (\d+\.\d+(?:\.\d+)?)/i.exec(stripAnsi(output ?? ''));
  return m?.[1] ?? null;
}

const DIAG_FILE = /^(.+?):(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/;
const DIAG_PLAIN = /^(error|warning|note):\s*(.*)$/i;

export function parseDiagnostics(lines: string[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const original of lines) {
    const raw = stripAnsi(original).replace(/\r$/, '');
    const f = DIAG_FILE.exec(raw);
    if (f) {
      out.push({
        file: f[1] ?? null,
        line: Number(f[2]),
        column: Number(f[3]),
        severity: f[4] as Diagnostic['severity'],
        message: (f[5] ?? '').trim(),
        raw,
      });
      continue;
    }
    const p = DIAG_PLAIN.exec(raw.trimStart());
    if (p) {
      out.push({
        file: null,
        line: null,
        column: null,
        severity: p[1].toLowerCase() as Diagnostic['severity'],
        message: (p[2] ?? '').trim(),
        raw,
      });
    }
  }
  return out;
}

export function validateProjectName(name: string): { ok: true } | { ok: false; reason: string } {
  if (name.length === 0) return { ok: false, reason: 'Project name must not be empty.' };
  if (!/^[A-Za-z_]/.test(name)) {
    return { ok: false, reason: 'Project name must start with a letter or underscore.' };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
    return {
      ok: false,
      reason: 'Project name may only contain letters, digits, underscores and hyphens.',
    };
  }
  return { ok: true };
}

export function redactLine(line: string): string {
  let s = line;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) return '***';
  s = s.replace(/(--password=)\S+/g, '$1***');
  s = s.replace(/((?:--password|-p)\s+)(?!-)\S+/g, '$1***');
  s = s.replace(/((?:--username|-u)(?:\s+|=))[^\s@]+@[^\s]+/g, '$1***');
  s = s.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '***');
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1***');
  return s;
}

export function buildOutcome(
  exit: { code: number | null; cancelled: boolean; timedOut: boolean },
  diagnostics: Diagnostic[],
): {
  status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  errorCount: number;
  warningCount: number;
} {
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  let status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  if (exit.code === 0) status = 'succeeded';
  else if (exit.cancelled) status = 'cancelled';
  else if (exit.timedOut) status = 'timed_out';
  else status = 'failed';
  return { status, errorCount, warningCount };
}
