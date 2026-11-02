import { describe, expect, it } from 'vitest';
import { bumpBuild, bundleIdFromXtoolYml, defaultConfig, parseConfig, serializeConfig, validateConfig } from './config';

const good = defaultConfig({ bundleId: 'com.zeta.mobil', appName: 'ZetaApp', email: 'a@b.co' });

describe('release config', () => {
  it('accepts a complete config and round-trips through JSON', () => {
    expect(validateConfig(good)).toEqual([]);
    const parsed = parseConfig(serializeConfig(good));
    expect(parsed).toEqual({ ok: true, config: good });
  });

  it('reports each invalid field', () => {
    const bad = { ...good, bundleId: 'nodots', appName: '2x', shortVersion: '1.2.3.4', buildNumber: 0, project: '../x', email: 'x/y@z.co' };
    expect(validateConfig(bad)).toHaveLength(6);
  });

  it('refuses secret-looking and unknown fields so keys never land in the repo', () => {
    for (const key of ['privateKey', 'p8', 'apiKey', 'password', 'token']) {
      const r = parseConfig(JSON.stringify({ ...good, [key]: 'x' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain(key);
    }
    expect(parseConfig('{"foo":1}').ok).toBe(false);
    expect(parseConfig('[]').ok).toBe(false);
    expect(parseConfig('not json').ok).toBe(false);
  });

  it('turns a missing build number into an invalid (NaN) value instead of guessing', () => {
    const r = parseConfig('{"bundleId":"com.a.b"}');
    expect(r.ok && validateConfig(r.config).some((e) => e.includes('Build'))).toBe(true);
  });

  it('bumps the build number and reads bundleID from xtool.yml', () => {
    expect(bumpBuild(good).buildNumber).toBe(2);
    expect(bundleIdFromXtoolYml('version: 1\nbundleID: com.zetapilates.mobil\niconPath: icon.png\n')).toBe('com.zetapilates.mobil');
    expect(bundleIdFromXtoolYml('version: 1')).toBeNull();
  });
});
