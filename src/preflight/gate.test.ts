import { describe, expect, it } from 'vitest';
import { gateInstall } from './gate';
import { renderMarkdown } from './report';
import { HONESTY_LINE, type PreflightReport, type StepResult } from './types';

const step = (id: StepResult['id'], status: StepResult['status'], summary = 'x', details: string[] = []): StepResult => ({ id, status, summary, details });

function report(steps: StepResult[], verdict: PreflightReport['verdict'], fingerprint = 'abc'): PreflightReport {
  return { version: 1, startedAt: '2026-11-03T10:00:00Z', finishedAt: '2026-11-03T10:01:00Z', project: '', fingerprint, steps, verdict };
}

describe('gateInstall', () => {
  it('no report → çalıştırılmadı', () => {
    expect(gateInstall(null, 'abc')).toEqual({ allowed: false, reason: 'Yayın öncesi denetim çalıştırılmadı' });
  });
  it('red report → kırmızı: <step name>', () => {
    const r = report([step('build', 'PASS'), step('policy', 'FAIL'), step('icon', 'FAIL')], 'red');
    expect(gateInstall(r, 'abc')).toEqual({ allowed: false, reason: 'Yayın öncesi denetim kırmızı: Politika' });
  });
  it('fingerprint mismatch → dosyalar değişti', () => {
    const r = report([step('build', 'PASS')], 'green');
    expect(gateInstall(r, 'other').reason).toBe('Dosyalar değişti, denetimi yeniden çalıştırın');
    expect(gateInstall(r, null).reason).toBe('Dosyalar değişti, denetimi yeniden çalıştırın');
  });
  it('green and matching → allowed', () => {
    expect(gateInstall(report([step('build', 'PASS')], 'green'), 'abc')).toEqual({ allowed: true, reason: null });
  });
});

describe('renderMarkdown', () => {
  it('markdown lists every step and the honesty line', () => {
    const md = renderMarkdown(report([step('build', 'PASS', 'Derleme başarılı'), step('manifest', 'FAIL', 'Manifest hataları var.', ['NSCameraUsageDescription eksik'])], 'red'));
    expect(md).toContain('# Yayın öncesi denetim');
    expect(md).toContain('| Derleme | Geçti | Derleme başarılı |');
    expect(md).toContain('| Manifest | Başarısız | Manifest hataları var. |');
    expect(md).toContain('- NSCameraUsageDescription eksik');
    expect(md).toContain(HONESTY_LINE);
    expect(md).toContain('## Claude Code için');
    expect(md).toContain('Kırmızı adımları düzelt, sonra denetimi yeniden çalıştır.');
  });
});
