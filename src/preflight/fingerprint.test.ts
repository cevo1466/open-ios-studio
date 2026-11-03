import { describe, expect, it } from 'vitest';
import { fingerprintFiles, fnv1a64Hex } from './fingerprint';

const a = { path: 'Sources/App/A.swift', content: 'struct A {}' };
const b = { path: 'xtool.yml', content: 'bundleID: com.example.app\n' };

describe('fingerprintFiles', () => {
  it('same files in different order give the same fingerprint', async () => {
    expect(await fingerprintFiles([a, b], 'none')).toBe(await fingerprintFiles([b, a], 'none'));
  });

  it('a content change changes the fingerprint', async () => {
    const before = await fingerprintFiles([a, b], 'none');
    const after = await fingerprintFiles([a, { ...b, content: 'bundleID: com.example.other\n' }], 'none');
    expect(after).not.toBe(before);
  });

  it('files under .open-ios-studio/ are ignored', async () => {
    const report = { path: '.open-ios-studio/preflight/latest.json', content: '{"verdict":"green"}' };
    expect(await fingerprintFiles([a, b, report], 'none')).toBe(await fingerprintFiles([a, b], 'none'));
  });

  it('the icon header participates', async () => {
    expect(await fingerprintFiles([a], '1024x1024:2')).not.toBe(await fingerprintFiles([a], 'none'));
  });

  it('is 64 hex characters', async () => {
    expect(await fingerprintFiles([a], 'none')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('fnv1a64Hex', () => {
  it('is stable', () => {
    expect(fnv1a64Hex('abc')).toBe('e71fa2190541574b');
    expect(fnv1a64Hex('')).toBe('cbf29ce484222325');
  });
});
