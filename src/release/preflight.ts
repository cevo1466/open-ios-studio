import { bundleIdFromXtoolYml, validateConfig, type ReleaseConfig } from './config';

/** Same vocabulary as the policy engine. */
export type CheckStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_VERIFIED';

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
}

interface ScannedFile {
  path: string;
  content: string;
}

/**
 * Source-level pre-checks before building. They read workspace text files only and never claim
 * App Store acceptance: what needs the built IPA or Apple's servers is reported NOT_VERIFIED.
 */
export function preflight(config: ReleaseConfig, files: ScannedFile[]): Check[] {
  const prefix = config.project === '' ? '' : `${config.project.replace(/\/$/, '')}/`;
  const find = (name: string) => files.find((f) => f.path === `${prefix}${name}`);
  const checks: Check[] = [];

  const configErrors = validateConfig(config);
  checks.push(
    configErrors.length === 0
      ? { id: 'config', status: 'PASS', message: 'Yayın ayarları geçerli.' }
      : { id: 'config', status: 'FAIL', message: configErrors.join(' ') },
  );

  const yml = find('xtool.yml');
  const ymlBundle = yml ? bundleIdFromXtoolYml(yml.content) : null;
  if (!yml) checks.push({ id: 'xtool-yml', status: 'FAIL', message: 'xtool.yml bulunamadı; proje klasörünü kontrol edin.' });
  else if (ymlBundle === null) checks.push({ id: 'xtool-yml', status: 'FAIL', message: 'xtool.yml içinde bundleID yok.' });
  else if (ymlBundle !== config.bundleId) checks.push({ id: 'xtool-yml', status: 'FAIL', message: `xtool.yml bundleID (${ymlBundle}) ile yayın ayarları (${config.bundleId}) farklı.` });
  else checks.push({ id: 'xtool-yml', status: 'PASS', message: 'Bundle id xtool.yml ile aynı.' });

  const privacy = find('PrivacyInfo.xcprivacy');
  if (!privacy) checks.push({ id: 'privacy-manifest', status: 'WARNING', message: 'PrivacyInfo.xcprivacy yok; Apple gizlilik manifesti ister. Hazırlama adımı IPA’ya yalnızca var olan dosyayı ekler.' });
  else if (!privacy.content.includes('<plist')) checks.push({ id: 'privacy-manifest', status: 'FAIL', message: 'PrivacyInfo.xcprivacy geçerli bir plist gibi görünmüyor.' });
  else checks.push({ id: 'privacy-manifest', status: 'PASS', message: 'Gizlilik manifesti var (içeriğin doğruluğu elle kontrol edilmeli).' });

  const info = find('Info.plist');
  if (info && !info.content.includes('ITSAppUsesNonExemptEncryption')) {
    checks.push({ id: 'encryption-flag', status: 'WARNING', message: 'Info.plist’te ITSAppUsesNonExemptEncryption yok; her yüklemede şifreleme sorusu çıkar.' });
  }

  checks.push({ id: 'icon-asset', status: 'NOT_VERIFIED', message: 'Simge kabulü: Linux’ta Assets.car üretilemiyor; yalnızca App Store Connect işlemesinde görülür.' });
  checks.push({ id: 'app-record', status: 'NOT_VERIFIED', message: 'Uygulama kaydı App Store Connect’te var mı: anahtar eklendikten sonra yükleme sırasında denetlenir.' });
  return checks;
}

export function preflightBlocks(checks: Check[]): boolean {
  return checks.some((c) => c.status === 'FAIL');
}
