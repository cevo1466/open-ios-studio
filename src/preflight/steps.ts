/**
 * Pure step functions: each turns an input the orchestrator collected into a `StepResult`.
 * No I/O here, so every rule is unit-tested without xtool or Tauri.
 */
import type { EvaluationReport, Rule, RuleResult } from '../policy/types';
import { parseDiagnostics } from '../xtool/parse';
import { STEP_ORDER, type StepResult, type Verdict } from './types';

export interface RunOutcome {
  code: number | null;
  lines: string[];
  timedOut: boolean;
  cancelled: boolean;
}

const MAX_DETAILS = 20;

function failureDetails(outcome: RunOutcome): string[] {
  const details: string[] = [];
  if (outcome.timedOut) details.push('Komut zaman aşımına uğradı.');
  if (outcome.cancelled) details.push('Komut iptal edildi.');
  return details;
}

export function buildStep(outcome: RunOutcome): StepResult {
  if (outcome.code === 0) return { id: 'build', status: 'PASS', summary: 'Derleme başarılı', details: [] };
  const errors = parseDiagnostics(outcome.lines)
    .filter((d) => d.severity === 'error')
    .map((d) => (d.file ? `${d.file}${d.line !== null ? `:${d.line}` : ''} ${d.message}` : d.message));
  const details = [...failureDetails(outcome), ...errors.slice(0, MAX_DETAILS)];
  if (errors.length === 0) details.push(...outcome.lines.slice(-MAX_DETAILS));
  return {
    id: 'build',
    status: 'FAIL',
    summary: outcome.code === null ? 'Derleme tamamlanamadı' : `Derleme başarısız (çıkış kodu ${outcome.code})`,
    details,
  };
}

export function testsStep(outcome: RunOutcome | { skipped: string }): StepResult {
  if ('skipped' in outcome) return { id: 'tests', status: 'NOT_VERIFIED', summary: outcome.skipped, details: [] };
  if (outcome.code === 0) return { id: 'tests', status: 'PASS', summary: 'swift test geçti', details: [] };
  return {
    id: 'tests',
    status: 'FAIL',
    summary: outcome.code === null ? 'swift test tamamlanamadı' : `swift test başarısız (çıkış kodu ${outcome.code})`,
    details: [...failureDetails(outcome), ...outcome.lines.slice(-MAX_DETAILS)].slice(-MAX_DETAILS),
  };
}

function describe(results: RuleResult[]): string[] {
  return results.map((r) => `${r.ruleId} ${r.name}: ${r.status}${r.findings.length > 0 ? ` (${r.findings.length} bulgu)` : ''}`);
}

export function policyStep(report: EvaluationReport): StepResult {
  const failed = report.results.filter((r) => r.status === 'FAIL');
  const serious = failed.filter((r) => r.severity === 'critical' || r.severity === 'high');
  const warned = report.results.filter((r) => r.status === 'WARNING');
  const unverified = report.results.filter((r) => r.status === 'NOT_VERIFIED' || r.status === 'BLOCKED').length;
  const tail = unverified > 0 ? `, ${unverified} doğrulanamadı` : '';
  if (report.blocksRelease || serious.length > 0) {
    return { id: 'policy', status: 'FAIL', summary: `${failed.length} kural başarısız${tail}`, details: describe([...failed, ...warned]) };
  }
  if (failed.length > 0 || warned.length > 0) {
    return { id: 'policy', status: 'WARNING', summary: `${failed.length} düşük önemli başarısız, ${warned.length} uyarı${tail}`, details: describe([...failed, ...warned]) };
  }
  const passed = report.results.filter((r) => r.status === 'PASS').length;
  return { id: 'policy', status: 'PASS', summary: `${passed} kural geçti${tail}`, details: [] };
}

export function secretsStep(report: EvaluationReport, rules: Rule[]): StepResult {
  const ids = new Set(rules.filter((r) => r.category === 'Secrets').map((r) => r.id));
  const mine = report.results.filter((r) => ids.has(r.ruleId));
  const ran = mine.filter((r) => r.status === 'PASS' || r.status === 'FAIL' || r.status === 'WARNING');
  if (ran.length === 0) {
    return { id: 'secrets', status: 'NOT_VERIFIED', summary: 'Gizli anahtar kuralları bu projede çalışmadı.', details: describe(mine) };
  }
  const failed = ran.filter((r) => r.status === 'FAIL');
  const warned = ran.filter((r) => r.status === 'WARNING');
  if (failed.length > 0) return { id: 'secrets', status: 'FAIL', summary: 'Kaynakta gizli anahtar veya güvensiz saklama bulundu.', details: describe([...failed, ...warned]) };
  if (warned.length > 0) return { id: 'secrets', status: 'WARNING', summary: 'Gizli anahtar kurallarında uyarı var.', details: describe(warned) };
  return { id: 'secrets', status: 'PASS', summary: 'Kaynakta gizli anahtar bulunmadı.', details: [] };
}

export function verdictOf(steps: StepResult[]): Verdict {
  return steps.some((s) => s.status === 'FAIL') ? 'red' : 'green';
}

export function firstFailing(steps: StepResult[]): StepResult | null {
  for (const id of STEP_ORDER) {
    const s = steps.find((x) => x.id === id);
    if (s && s.status === 'FAIL') return s;
  }
  return null;
}
