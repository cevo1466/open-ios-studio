import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../policy/types';
import { checkManifest, readXtoolConfig } from './manifest';

const f = (path: string, content: string): ProjectFile => ({ path, content });
const xtoolYml = (extra = '') => f('xtool.yml', `version: 1\nbundleID: com.example.app\n${extra}`);
const plist = (keys: string[]) =>
  `<?xml version="1.0"?><plist version="1.0"><dict>${keys.map((k) => `<key>${k}</key><string>x</string>`).join('')}</dict></plist>`;
const privacy = f('PrivacyInfo.xcprivacy', '<plist version="1.0"><dict><key>NSPrivacyTracking</key><false/></dict></plist>');

describe('readXtoolConfig', () => {
  it('reads bundleID, infoPath and iconPath with the icon default', () => {
    expect(readXtoolConfig([xtoolYml()])).toEqual({ bundleId: 'com.example.app', infoPath: null, iconPath: 'icon.png' });
    expect(readXtoolConfig([xtoolYml('infoPath: Sources/App/Info.plist\niconPath: art/icon.png\n')])).toEqual({
      bundleId: 'com.example.app',
      infoPath: 'Sources/App/Info.plist',
      iconPath: 'art/icon.png',
    });
  });
});

describe('checkManifest', () => {
  it('missing xtool.yml is FAIL', () => {
    const r = checkManifest([f('Package.swift', '')]);
    expect(r.status).toBe('FAIL');
    expect(r.summary).toContain('xtool.yml');
  });

  it('bundleID without a dot is FAIL', () => {
    const r = checkManifest([f('xtool.yml', 'bundleID: myapp\n')]);
    expect(r.status).toBe('FAIL');
    expect(r.details.join(' ')).toContain('bundleID');
  });

  it('fresh xtool project without Info.plist is NOT_VERIFIED with the defaults reason', () => {
    const r = checkManifest([xtoolYml(), f('Sources/App/App.swift', 'import SwiftUI\n@main struct A: App {}')]);
    expect(r.status).toBe('NOT_VERIFIED');
    expect(r.summary).toContain('xtool varsayılanları kullanılıyor');
  });

  it('AVFoundation import without NSCameraUsageDescription is FAIL naming the key', () => {
    const r = checkManifest([xtoolYml(), f('Sources/App/Scan.swift', 'import AVFoundation\n')]);
    expect(r.status).toBe('FAIL');
    expect(r.details.join(' ')).toContain('NSCameraUsageDescription');
  });

  it('infoPath outside the root is honoured', () => {
    const files = [
      xtoolYml('infoPath: Sources/App/Info.plist\n'),
      f('Sources/App/Scan.swift', 'import AVFoundation\n'),
      f('Sources/App/Info.plist', plist(['NSCameraUsageDescription', 'CFBundleShortVersionString', 'CFBundleVersion'])),
      privacy,
    ];
    expect(checkManifest(files).status).toBe('PASS');
  });

  it('Info.plist without CFBundleVersion is WARNING', () => {
    const files = [xtoolYml('infoPath: Info.plist\n'), f('Info.plist', plist(['CFBundleShortVersionString'])), privacy];
    const r = checkManifest(files);
    expect(r.status).toBe('WARNING');
    expect(r.details.join(' ')).toContain('CFBundleVersion');
  });

  it('UserDefaults without PrivacyInfo.xcprivacy is WARNING', () => {
    const r = checkManifest([xtoolYml(), f('Sources/App/Store.swift', 'let d = UserDefaults.standard\n')]);
    expect(r.status).toBe('WARNING');
    expect(r.details.join(' ')).toContain('PrivacyInfo.xcprivacy');
  });

  it('PrivacyInfo.xcprivacy that is not a dict is FAIL', () => {
    const r = checkManifest([xtoolYml(), f('PrivacyInfo.xcprivacy', 'not a plist')]);
    expect(r.status).toBe('FAIL');
  });
});
