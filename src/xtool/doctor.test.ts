import { describe, expect, it } from 'vitest';
import { DOCTOR_LABELS, doctorHint, doctorName, summarizeDoctor, type DoctorCheck } from './doctor';

const c = (id: string, status: DoctorCheck['status'], detail = ''): DoctorCheck => ({ id, status, detail });

describe('doctor labels', () => {
  it('has a Turkish name and a hint for every id the Rust side emits', () => {
    for (const id of ['swift', 'darwin-sdk', 'xtool', 'xtool-sdk', 'apple-account', 'device', 'usbmuxd', 'git']) {
      expect(DOCTOR_LABELS[id]?.name, id).toBeTruthy();
      expect(DOCTOR_LABELS[id]?.hint, id).toBeTruthy();
    }
    expect(doctorName('unknown-id')).toBe('unknown-id');
  });

  it('shows hints only for FAIL and WARN', () => {
    expect(doctorHint(c('swift', 'FAIL'))).toContain('swift.org');
    expect(doctorHint(c('device', 'WARN'))).toContain('Geliştirici Modu');
    expect(doctorHint(c('swift', 'PASS'))).toBeNull();
    expect(doctorHint(c('darwin-sdk', 'NOT_VERIFIED'))).toBeNull();
  });
});

describe('summarizeDoctor', () => {
  it('a FAIL blocks the build', () => {
    expect(summarizeDoctor([c('swift', 'FAIL'), c('xtool', 'PASS')]).tone).toBe('error');
  });
  it('warnings and unverified items are not failures', () => {
    const s = summarizeDoctor([c('swift', 'PASS'), c('device', 'WARN'), c('apple-account', 'NOT_VERIFIED')]);
    expect(s.tone).toBe('warn');
    expect(s.text).toContain('1 uyarı');
    expect(s.text).toContain('1 doğrulanamadı');
  });
  it('all PASS never claims a build succeeded', () => {
    const s = summarizeDoctor([c('swift', 'PASS'), c('xtool', 'PASS')]);
    expect(s.tone).toBe('ok');
    expect(s.text).toMatch(/derleme başarısı değildir/);
  });
});
