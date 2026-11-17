/** Labels and fix hints for the environment check (`env_doctor`). The Rust side returns ids and statuses only. */

export type DoctorStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_VERIFIED';

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  detail: string;
}

export const DOCTOR_STATUS_LABEL: Record<DoctorStatus, string> = {
  PASS: 'Tamam',
  FAIL: 'Eksik',
  WARN: 'Uyarı',
  NOT_VERIFIED: 'Doğrulanamadı',
};

interface Label {
  name: string;
  /** Shown for FAIL/WARN only. */
  hint?: string;
}

export const DOCTOR_LABELS: Record<string, Label> = {
  swift: { name: 'Swift araç zinciri', hint: 'swift.org/install/linux adresinden (swiftly) kurun; kurulumdan sonra yeni bir terminal açın. Uygulama masaüstünden açılıyorsa PATH ayarı ~/.profile içinde de olmalı.' },
  'darwin-sdk': { name: 'Darwin SDK (swift sdk list)', hint: '`xtool setup` komutunu Xcode.xip yoluyla çalıştırın (developer.apple.com üzerinden Apple Kimliğinizle indirilir). SDK üretimi uzun sürebilir.' },
  xtool: { name: 'xtool', hint: 'github.com/xtool-org/xtool/releases adresinden AppImage indirin, adını xtool yapın, chmod +x verin ve /usr/local/bin gibi PATH içindeki bir klasöre taşıyın. Test edilen sürümden farklı bir sürümde çıktı biçimi değişmiş olabilir.' },
  'xtool-sdk': { name: 'xtool SDK durumu', hint: '`xtool setup` ile SDK kurulmalı; Studio Apple kimlik bilgilerini görmez, komutu kendi terminalinizde çalıştırın.' },
  'apple-account': { name: 'Apple hesabı (imza)', hint: 'Derleme çalışır; iPhone’a yüklemek için `xtool setup` veya `xtool auth login` ile kendi terminalinizde giriş yapın.' },
  device: { name: 'Bağlı iPhone', hint: 'Veri kablosuyla bağlayın, kilidi açın, "Bu bilgisayara güven" deyin ve Ayarlar > Gizlilik ve Güvenlik altından Geliştirici Modu’nu açın.' },
  usbmuxd: { name: 'usbmuxd (USB bağlantısı)', hint: 'sudo apt install usbmuxd' },
  git: { name: 'git', hint: 'sudo apt install git' },
};

export function doctorName(id: string): string {
  return DOCTOR_LABELS[id]?.name ?? id;
}

export function doctorHint(c: DoctorCheck): string | null {
  if (c.status !== 'FAIL' && c.status !== 'WARN') return null;
  return DOCTOR_LABELS[c.id]?.hint ?? null;
}

export interface DoctorSummary {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

/** One line for the panel header; FAIL counts as blocking a build, WARN as device/signing work. */
export function summarizeDoctor(checks: DoctorCheck[]): DoctorSummary {
  const fail = checks.filter((c) => c.status === 'FAIL').length;
  const warn = checks.filter((c) => c.status === 'WARN').length;
  const unverified = checks.filter((c) => c.status === 'NOT_VERIFIED').length;
  if (fail > 0) return { tone: 'error', text: `${fail} eksik: derleme bu hâliyle çalışmaz.` };
  if (warn > 0 || unverified > 0) {
    const parts = [warn > 0 ? `${warn} uyarı` : null, unverified > 0 ? `${unverified} doğrulanamadı` : null].filter(Boolean);
    return { tone: 'warn', text: `Derleme için gerekenler tamam; ${parts.join(', ')} (cihaz/imza adımları).` };
  }
  return { tone: 'ok', text: 'Gerekli her şey hazır. Bu bir derleme başarısı değildir; gerçek derlemeyi Derle panelinden yapın.' };
}
