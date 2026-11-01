import { describe, expect, it } from 'vitest';
import { canRunOnDevice, deviceStatus, shortUdid } from './deviceView';
import type { Device } from './types';

const dev: Device = { name: 'iPhone', connection: 'usb', udid: '00008110-001234567890401E' };
const base = { xtoolFound: true, authLoggedIn: true, devices: [dev], loading: false, error: null };

describe('deviceStatus', () => {
  it('xtool missing', () => expect(deviceStatus({ ...base, xtoolFound: false }).kind).toBe('xtool-missing'));
  it('checking while loading', () => expect(deviceStatus({ ...base, loading: true }).kind).toBe('checking'));
  it('checking when never queried', () => expect(deviceStatus({ ...base, devices: null }).kind).toBe('checking'));
  it('error', () => {
    const s = deviceStatus({ ...base, error: 'boom' });
    expect(s.kind).toBe('error');
    expect(s.detail).toBe('boom');
  });
  it('no device', () => {
    const s = deviceStatus({ ...base, devices: [] });
    expect(s.kind).toBe('no-device');
    expect(s.title).toBe('iPhone algılanmadı');
    for (const w of ['USB', 'kilidini', 'Trust', 'Developer Mode', 'usbmuxd']) expect(s.detail).toContain(w);
  });
  it('not signed in', () => {
    for (const a of [false, null]) {
      const s = deviceStatus({ ...base, authLoggedIn: a });
      expect(s.kind).toBe('not-signed-in');
      expect(s.detail).toContain('Apple kimlik bilgilerini');
      expect(s.detail).toContain('xtool setup');
      expect(s.detail).toContain('xtool auth login');
    }
  });
  it('ready', () => expect(deviceStatus(base).kind).toBe('ready'));
});

describe('canRunOnDevice', () => {
  const ok = { xtoolFound: true, hasWorkspace: true, running: false, authLoggedIn: true, devices: [dev], selectedUdid: null };
  it('ok with one device', () => expect(canRunOnDevice(ok)).toEqual({ ok: true, reason: null }));
  it('ok with selected', () => expect(canRunOnDevice({ ...ok, selectedUdid: dev.udid }).ok).toBe(true));
  it('xtool missing', () => expect(canRunOnDevice({ ...ok, xtoolFound: false }).reason).toMatch(/xtool/));
  it('running', () => expect(canRunOnDevice({ ...ok, running: true }).reason).toMatch(/Zaten çalışan/));
  it('no workspace', () => expect(canRunOnDevice({ ...ok, hasWorkspace: false }).reason).toMatch(/çalışma klasörü/));
  it('no devices', () => expect(canRunOnDevice({ ...ok, devices: [] }).reason).toMatch(/iPhone algılanmadı/));
  it('not signed in', () => expect(canRunOnDevice({ ...ok, authLoggedIn: null }).reason).toMatch(/Oturum açık değil/));
  it('stale selection', () => expect(canRunOnDevice({ ...ok, selectedUdid: 'zzz' }).reason).toMatch(/bağlantısı kesildi/));
  it('multiple, none selected', () => {
    const two = [dev, { ...dev, udid: 'AAAA' }];
    expect(canRunOnDevice({ ...ok, devices: two }).reason).toMatch(/bir cihaz seçin/);
  });
});

describe('shortUdid', () => {
  it('shortens', () => expect(shortUdid('00008110-001234567890401E')).toBe('00008110…401E'));
  it('keeps short', () => expect(shortUdid('abc')).toBe('abc'));
});
