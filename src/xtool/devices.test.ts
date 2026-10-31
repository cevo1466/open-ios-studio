import { describe, expect, it } from 'vitest';
import { parseAuthStatus, parseDevices } from './parse';

describe('parseDevices (format from xtool source; not observed on hardware)', () => {
  it('parses name, connection and udid', () => {
    const out = "Melih's iPhone [usb]: 00008110-001A2B3C4D5E6F78\nTest iPad [network]: 00008020-AABBCCDDEEFF0011\n";
    expect(parseDevices(out)).toEqual([
      { name: "Melih's iPhone", connection: 'usb', udid: '00008110-001A2B3C4D5E6F78' },
      { name: 'Test iPad', connection: 'network', udid: '00008020-AABBCCDDEEFF0011' },
    ]);
  });
  it('returns nothing for the real no-device output and for waiting notices', () => {
    expect(parseDevices('')).toEqual([]);
    expect(parseDevices('Waiting for devices to be connected...\n')).toEqual([]);
  });
  it('ignores malformed lines instead of guessing', () => {
    expect(parseDevices('iPhone [usb]: not-a-udid!\nrandom text')).toEqual([]);
  });
});

describe('parseAuthStatus', () => {
  it('detects the observed logged-out text', () => {
    expect(parseAuthStatus('Logged out\n')).toEqual({ loggedIn: false, detail: 'Logged out' });
  });
  it('treats other text as a login and keeps it for display', () => {
    expect(parseAuthStatus('Logged in.\nTeam: ABC').loggedIn).toBe(true);
    expect(parseAuthStatus('').loggedIn).toBe(false);
  });
});
