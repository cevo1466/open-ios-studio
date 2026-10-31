import { describe, expect, it } from 'vitest';
import { compatibility, parseDiagnostics, parseXtoolVersion, validateProjectName } from './parse';

const files = import.meta.glob('../../fixtures/xtool-1.24.0/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const read = (name: string): string => {
  const hit = Object.entries(files).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`missing fixture ${name}`);
  return hit[1];
};

describe('real xtool 1.24.0 output', () => {
  it('version parses and is the tested release', () => {
    const v = parseXtoolVersion(read('version.stdout'));
    expect(v).toMatchObject({ kind: 'semver', value: '1.24.0' });
    expect(compatibility(v)).toBe('tested');
    expect(read('version.exit').trim()).toBe('0');
  });

  it('devices --no-wait returns immediately with success and no devices', () => {
    expect(read('devices-no-wait.exit').trim()).toBe('0');
    expect(read('devices-no-wait.stdout').trim()).toBe('');
  });

  it('documents --wait as the default for devices (the reason we pass --no-wait)', () => {
    expect(read('help-devices.stdout')).toContain('(default: --wait)');
  });

  it('dev build has the flags the adapter relies on', () => {
    const help = read('help-dev-build.stdout');
    expect(help).toContain('-c, --configuration');
    expect(help).toContain('values: debug, release');
  });

  it('new rejects bad and existing names with exit 1, matching our validator', () => {
    expect(read('new-badname.exit').trim()).toBe('1');
    expect(read('new-badname.stderr')).toContain("Package name '2bad' is invalid");
    expect(validateProjectName('2bad').ok).toBe(false);
    expect(read('new-exists.exit').trim()).toBe('1');
    expect(read('new-exists.stderr')).toContain('already exists');
  });

  it('new creates the documented SwiftPM layout (no xcodeproj)', () => {
    const created = read('new-ok.files').trim().split('\n');
    expect(created).toContain('Demo-App/Package.swift');
    expect(created).toContain('Demo-App/xtool.yml');
    expect(created).toContain('Demo-App/Sources/Demo_App/ContentView.swift');
    expect(created.some((f) => f.includes('.xcodeproj'))).toBe(false);
  });

  it('build outside a package fails with a file-less error line', () => {
    expect(read('build-no-package.exit').trim()).toBe('1');
    const [d] = parseDiagnostics(read('build-no-package.stderr').split('\n'));
    expect(d).toMatchObject({ severity: 'error', file: null });
    expect(d.message).toContain('Package.swift');
  });

  it('sdk and auth status are plain one-line text with exit 0', () => {
    expect(read('sdk-status.stdout').trim()).toBe('Not installed');
    expect(read('auth-status.stdout').trim()).toBe('Logged out');
  });
});
