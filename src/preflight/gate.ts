/**
 * The install/release gate (owner decision 2026-11-03): red blocks "Derle ve Yükle", device
 * install/launch and release steps until the check is green for the current files.
 */
import { firstFailing } from './steps';
import { STEP_NAME, type PreflightReport } from './types';

export interface GateDecision {
  allowed: boolean;
  reason: string | null;
}

export const GATE_NOT_RUN = 'Yayın öncesi denetim çalıştırılmadı';
export const GATE_STALE = 'Dosyalar değişti, denetimi yeniden çalıştırın';

/**
 * `currentFingerprint` is the fingerprint of the files as they are now; `null` means it is not
 * known, which counts as a mismatch (never allow on a guess).
 */
export function gateInstall(report: PreflightReport | null, currentFingerprint: string | null): GateDecision {
  if (!report) return { allowed: false, reason: GATE_NOT_RUN };
  if (report.verdict === 'red') {
    const failing = firstFailing(report.steps);
    return { allowed: false, reason: `Yayın öncesi denetim kırmızı: ${failing ? STEP_NAME[failing.id] : 'bilinmeyen adım'}` };
  }
  if (currentFingerprint === null || currentFingerprint !== report.fingerprint) return { allowed: false, reason: GATE_STALE };
  return { allowed: true, reason: null };
}
