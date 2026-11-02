import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { preflight, preflightBlocks } from './preflight';
import { releasePaths } from './paths';

const config = defaultConfig({ bundleId: 'com.zeta.mobil', appName: 'ZetaApp', email: 'a@b.co' });
const files = (extra: Record<string, string> = {}) =>
  Object.entries({ 'xtool.yml': 'bundleID: com.zeta.mobil\n', 'PrivacyInfo.xcprivacy': '<?xml?><plist/>', 'Info.plist': '<plist ITSAppUsesNonExemptEncryption/>', ...extra }).map(([path, content]) => ({ path, content }));
const status = (c: ReturnType<typeof preflight>, id: string) => c.find((x) => x.id === id)?.status;

describe('preflight', () => {
  it('passes a consistent project but never claims icon or app-record acceptance', () => {
    const c = preflight(config, files());
    expect(preflightBlocks(c)).toBe(false);
    expect(status(c, 'xtool-yml')).toBe('PASS');
    expect(status(c, 'icon-asset')).toBe('NOT_VERIFIED');
    expect(status(c, 'app-record')).toBe('NOT_VERIFIED');
  });

  it('fails on bundle id mismatch and missing xtool.yml', () => {
    expect(status(preflight({ ...config, bundleId: 'com.other.app' }, files()), 'xtool-yml')).toBe('FAIL');
    expect(preflightBlocks(preflight(config, files().filter((f) => f.path !== 'xtool.yml')))).toBe(true);
  });

  it('warns about a missing privacy manifest and the encryption flag', () => {
    const c = preflight(config, files({ 'Info.plist': '<plist/>' }).filter((f) => f.path !== 'PrivacyInfo.xcprivacy'));
    expect(status(c, 'privacy-manifest')).toBe('WARNING');
    expect(status(c, 'encryption-flag')).toBe('WARNING');
    expect(preflightBlocks(c)).toBe(false);
  });

  it('resolves files relative to a project subfolder', () => {
    const sub = { ...config, project: 'apps/ios' };
    const c = preflight(sub, [{ path: 'apps/ios/xtool.yml', content: 'bundleID: com.zeta.mobil' }]);
    expect(status(c, 'xtool-yml')).toBe('PASS');
  });

  it('builds artifact paths inside the workspace', () => {
    expect(releasePaths(config)).toEqual({ built: 'xtool/ZetaApp.ipa', repacked: '.studio/release/ZetaApp-1.0.0-1-repacked.ipa', signed: '.studio/release/ZetaApp-1.0.0-1-signed.ipa' });
    expect(releasePaths({ ...config, project: 'apps/ios' }).built).toBe('apps/ios/xtool/ZetaApp.ipa');
  });
});
