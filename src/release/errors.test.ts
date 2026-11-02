import { describe, expect, it } from 'vitest';
import { explainError } from './errors';

describe('explainError', () => {
  it.each([
    ['Apple 401: Authentication credentials are missing (NOT_AUTHORIZED)', 'Apple anahtarı reddetti.'],
    ['Apple 403: FORBIDDEN_ERROR', 'Bu anahtarın yetkisi yetmiyor.'],
    ['No app with this bundle id exists in App Store Connect.', 'App Store Connect’te bu bundle id ile uygulama yok.'],
    ['Run the prepare step first (no profile stored).', 'Sertifika ve profil hazır değil.'],
    ['openssl was not found on PATH.', 'openssl bulunamadı.'],
    ['Profil kimliği X bundle id ile (y) eşleşmiyor.', 'Profil bundle id ile eşleşmiyor.'],
    ['SHA-256 uyuşmuyor', 'İndirilen dosya doğrulanamadı.'],
  ])('%s', (message, title) => {
    expect(explainError(message).title).toBe(title);
  });

  it('falls back to a generic message and never echoes the raw text', () => {
    const e = explainError('something odd with secret-token-123');
    expect(e.title).toBe('İşlem başarısız oldu.');
    expect(JSON.stringify(e)).not.toContain('secret-token');
  });
});
