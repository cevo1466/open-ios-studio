import { describe, expect, it } from 'vitest';
import { checkIcon, iconHeaderString } from './icon';

describe('checkIcon', () => {
  it('1024 square colorType 2 is PASS', () => {
    expect(checkIcon({ width: 1024, height: 1024, colorType: 2 }, 'icon.png').status).toBe('PASS');
  });
  it('colorType 6 (alpha) is FAIL', () => {
    const r = checkIcon({ width: 1024, height: 1024, colorType: 6 }, 'icon.png');
    expect(r.status).toBe('FAIL');
    expect(r.details.join(' ')).toMatch(/alfa|alpha/i);
  });
  it('512 is FAIL', () => {
    expect(checkIcon({ width: 512, height: 512, colorType: 2 }, 'icon.png').status).toBe('FAIL');
  });
  it('missing header is FAIL naming the path', () => {
    const r = checkIcon(null, 'art/icon.png');
    expect(r.status).toBe('FAIL');
    expect(r.summary).toContain('art/icon.png');
  });
});

describe('iconHeaderString', () => {
  it('formats the header for the fingerprint', () => {
    expect(iconHeaderString({ width: 1024, height: 1024, colorType: 2 })).toBe('1024x1024:2');
    expect(iconHeaderString(null)).toBe('none');
  });
});
