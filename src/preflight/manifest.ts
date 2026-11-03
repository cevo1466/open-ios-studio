/**
 * Manifest step: xtool.yml, the Info.plist it names and PrivacyInfo.xcprivacy, checked from the
 * scanned text files only (no parser dependencies; the files are small and regular).
 *
 * A fresh `xtool new` project has no Info.plist and xtool supplies the version keys itself, so the
 * absence of the file is NOT_VERIFIED, never FAIL, unless an imported framework requires a usage
 * description that only an Info.plist can carry.
 */
import type { ProjectFile } from '../policy/types';
import type { StepResult } from './types';

export interface XtoolConfig {
  bundleId: string | null;
  infoPath: string | null;
  /** Defaults to `icon.png` like xtool. */
  iconPath: string;
}

/** Framework imports that require a usage description key in the Info.plist. */
export const USAGE_KEYS: { pattern: RegExp; key: string; what: string }[] = [
  { pattern: /\bimport\s+AVFoundation\b|\bAVCaptureDevice\b/, key: 'NSCameraUsageDescription', what: 'kamera' },
  { pattern: /\bimport\s+CoreLocation\b|\bCLLocationManager\b/, key: 'NSLocationWhenInUseUsageDescription', what: 'konum' },
  { pattern: /\bimport\s+Photos(UI)?\b|\bPHPicker\b|\bPHPhotoLibrary\b/, key: 'NSPhotoLibraryUsageDescription', what: 'fotoğraflar' },
  { pattern: /\bimport\s+Contacts\b|\bCNContactStore\b/, key: 'NSContactsUsageDescription', what: 'kişiler' },
  { pattern: /\bimport\s+EventKit\b|\bEKEventStore\b/, key: 'NSCalendarsWriteOnlyAccessUsageDescription', what: 'takvim' },
  { pattern: /\bimport\s+LocalAuthentication\b|\bLAContext\b/, key: 'NSFaceIDUsageDescription', what: 'Face ID' },
];

/** APIs Apple lists as "required reason"; using one needs a PrivacyInfo.xcprivacy entry. */
export const REQUIRED_REASON_APIS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bUserDefaults\b/, what: 'UserDefaults' },
  { pattern: /\b(creationDate|modificationDate|contentModificationDateKey|\.fileModificationDate)\b/, what: 'dosya zaman damgaları' },
  { pattern: /\b(systemUptime|boottime|mach_absolute_time)\b/, what: 'sistem açılış zamanı' },
  { pattern: /\bvolumeAvailableCapacity/, what: 'disk alanı' },
];

function yamlValue(yaml: string, key: string): string | null {
  const m = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm').exec(yaml);
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '').trim() || null;
}

export function readXtoolConfig(files: ProjectFile[]): XtoolConfig {
  const yml = files.find((f) => f.path === 'xtool.yml')?.content ?? '';
  return {
    bundleId: yamlValue(yml, 'bundleID'),
    infoPath: yamlValue(yml, 'infoPath'),
    iconPath: yamlValue(yml, 'iconPath') ?? 'icon.png',
  };
}

const BUNDLE_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function plistHasKey(plist: string, key: string): boolean {
  return new RegExp(`<key>\\s*${key}\\s*</key>`).test(plist);
}

function isSwiftSource(f: ProjectFile): boolean {
  return f.path.endsWith('.swift') && !f.path.startsWith('Tests/') && f.path !== 'Package.swift';
}

export function checkManifest(files: ProjectFile[]): StepResult {
  const details: string[] = [];
  let status: StepResult['status'] = 'PASS';
  const worsen = (s: 'FAIL' | 'WARNING') => {
    if (s === 'FAIL' || status === 'PASS') status = s;
  };

  const yml = files.find((f) => f.path === 'xtool.yml');
  if (!yml) {
    return { id: 'manifest', status: 'FAIL', summary: 'xtool.yml yok: proje xtool ile paketlenemez.', details: ['Proje kökünde xtool.yml bulunmalı (xtool new oluşturur).'] };
  }
  const cfg = readXtoolConfig(files);
  if (!cfg.bundleId || !BUNDLE_ID_RE.test(cfg.bundleId)) {
    worsen('FAIL');
    details.push(`xtool.yml bundleID ters alan adı biçiminde olmalı (ör. com.sirket.uygulama); bulunan: ${cfg.bundleId ?? '(yok)'}`);
  }

  const sources = files.filter(isSwiftSource).map((f) => f.content).join('\n');
  const plistFile = cfg.infoPath ? files.find((f) => f.path === cfg.infoPath) : null;
  const plist = plistFile?.content ?? '';
  const requiredKeys = USAGE_KEYS.filter((u) => u.pattern.test(sources));
  for (const u of requiredKeys) {
    if (!plistFile || !plistHasKey(plist, u.key)) {
      worsen('FAIL');
      details.push(
        plistFile
          ? `${u.key} eksik: kaynaklar ${u.what} erişimi kullanıyor; ${cfg.infoPath} içine açıklama ekleyin.`
          : `${u.key} gerekli: kaynaklar ${u.what} erişimi kullanıyor; xtool.yml'de infoPath ile bir Info.plist tanımlayıp bu anahtarı ekleyin.`,
      );
    }
  }

  let infoNote: string | null = null;
  if (plistFile) {
    for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
      if (!plistHasKey(plist, key)) {
        worsen('WARNING');
        details.push(`${cfg.infoPath}: ${key} yok; xtool varsayılan sürümü yazar, App Store için açıkça verin.`);
      }
    }
  } else if (cfg.infoPath) {
    worsen('FAIL');
    details.push(`xtool.yml infoPath '${cfg.infoPath}' dosyası bulunamadı.`);
  } else if (requiredKeys.length === 0) {
    infoNote = 'Info.plist yok, xtool varsayılanları kullanılıyor';
  }

  const privacyFile = files.find((f) => f.path === 'PrivacyInfo.xcprivacy');
  const usedApis = REQUIRED_REASON_APIS.filter((a) => a.pattern.test(sources));
  if (privacyFile) {
    if (!/<plist[\s>][\s\S]*<dict>/.test(privacyFile.content)) {
      worsen('FAIL');
      details.push('PrivacyInfo.xcprivacy bir plist sözlüğü değil; Apple bu dosyayı okuyamaz.');
    }
  } else if (usedApis.length > 0) {
    worsen('WARNING');
    details.push(`PrivacyInfo.xcprivacy yok; kaynaklar gerekçe isteyen API kullanıyor: ${usedApis.map((a) => a.what).join(', ')}.`);
  }

  if (status === 'PASS' && infoNote) {
    return { id: 'manifest', status: 'NOT_VERIFIED', summary: `${infoNote}; usage açıklaması gerektiren bir çerçeve bulunmadı.`, details };
  }
  const summary =
    status === 'PASS'
      ? `bundleID ${cfg.bundleId}${cfg.infoPath ? `, ${cfg.infoPath}` : ''}${privacyFile ? ', PrivacyInfo.xcprivacy' : ''} uygun.`
      : status === 'WARNING'
        ? 'Manifest eksikleri var; App Store öncesi tamamlayın.'
        : 'Manifest hataları var.';
  return { id: 'manifest', status, summary, details };
}
