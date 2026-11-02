/**
 * Workspace release settings (`.studio/release.json`). Holds NO secrets: Apple credentials live
 * in the OS keyring (ADR-0014). Anything that looks like a secret is rejected on read.
 */

export interface ReleaseConfig {
  /** Reverse-DNS bundle id, as in xtool.yml. */
  bundleId: string;
  /** xtool package name (the `.ipa` is named after it). */
  appName: string;
  /** CFBundleShortVersionString, e.g. 1.0.0 */
  shortVersion: string;
  /** CFBundleVersion, a growing integer. */
  buildNumber: number;
  /** Workspace-relative project folder ('' = workspace root). */
  project: string;
  /** Contact e-mail written into the certificate request. */
  email: string;
}

export const RELEASE_CONFIG_PATH = '.studio/release.json';

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const SHORT_VERSION = /^\d+(\.\d+){0,2}$/;
const APP_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const EMAIL = /^[^\s@/=,]+@[^\s@/=,]+\.[^\s@/=,]+$/;
const SECRET_KEY = /key|secret|password|passwd|token|p8|p12|private|credential/i;

export function defaultConfig(partial: Partial<ReleaseConfig> = {}): ReleaseConfig {
  return { bundleId: '', appName: '', shortVersion: '1.0.0', buildNumber: 1, project: '', email: '', ...partial };
}

export function validateConfig(c: ReleaseConfig): string[] {
  const errors: string[] = [];
  if (!BUNDLE_ID.test(c.bundleId)) errors.push('Bundle id biçimi geçersiz (örn. com.firma.uygulama).');
  if (!APP_NAME.test(c.appName)) errors.push('Uygulama (paket) adı geçersiz: harfle başlamalı, yalnızca harf, rakam, _ ve - içerebilir.');
  if (!SHORT_VERSION.test(c.shortVersion)) errors.push('Sürüm numarası 1, 1.2 ya da 1.2.3 biçiminde olmalı.');
  if (!Number.isInteger(c.buildNumber) || c.buildNumber < 1) errors.push('Build numarası 1 veya daha büyük bir tam sayı olmalı.');
  if (c.project.startsWith('/') || c.project.split('/').includes('..')) errors.push('Proje klasörü çalışma klasörünün içinde olmalı.');
  if (!EMAIL.test(c.email)) errors.push('Geçerli bir e-posta adresi girin (sertifika isteğinde kullanılır).');
  return errors;
}

export type ParseResult = { ok: true; config: ReleaseConfig } | { ok: false; reason: string };

export function parseConfig(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'release.json geçerli JSON değil.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'release.json bir nesne olmalı.' };
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['bundleId', 'appName', 'shortVersion', 'buildNumber', 'project', 'email']);
  for (const key of Object.keys(obj)) {
    if (SECRET_KEY.test(key)) return { ok: false, reason: `release.json gizli bilgi gibi görünen bir alan içeriyor (${key}); kaldırın. Anahtarlar işletim sistemi anahtarlığında tutulur.` };
    if (!allowed.has(key)) return { ok: false, reason: `Bilinmeyen alan: ${key}` };
  }
  const str = (k: string, d = '') => (typeof obj[k] === 'string' ? (obj[k] as string) : d);
  const build = typeof obj.buildNumber === 'number' ? obj.buildNumber : Number.NaN;
  return {
    ok: true,
    config: {
      bundleId: str('bundleId'),
      appName: str('appName'),
      shortVersion: str('shortVersion', '1.0.0'),
      buildNumber: build,
      project: str('project'),
      email: str('email'),
    },
  };
}

export function serializeConfig(c: ReleaseConfig): string {
  const { bundleId, appName, shortVersion, buildNumber, project, email } = c;
  return `${JSON.stringify({ bundleId, appName, shortVersion, buildNumber, project, email }, null, 2)}\n`;
}

/** Apple rejects a repeated build number for the same version: bump after every upload. */
export function bumpBuild(c: ReleaseConfig): ReleaseConfig {
  return { ...c, buildNumber: c.buildNumber + 1 };
}

/** Read bundleID from an xtool.yml (flat key: value file). */
export function bundleIdFromXtoolYml(text: string): string | null {
  const m = /^bundleID:\s*([^\s#]+)/m.exec(text);
  return m?.[1] ?? null;
}
