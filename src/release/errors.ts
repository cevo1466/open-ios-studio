/** Turns tool / Apple error text into a short Turkish explanation plus the next step. */

export interface Explained {
  title: string;
  next: string;
}

const RULES: Array<[RegExp, Explained]> = [
  [/NOT_AUTHORIZED|\b401\b/, { title: 'Apple anahtarı reddetti.', next: 'Issuer ID, Key ID ve .p8 dosyasının aynı anahtara ait olduğunu ve anahtarın iptal edilmediğini kontrol edin.' }],
  [/FORBIDDEN|\b403\b/, { title: 'Bu anahtarın yetkisi yetmiyor.', next: 'App Store Connect’te anahtarın rolünü “Admin” ya da “App Manager” yapın.' }],
  [/No app with this bundle id/i, { title: 'App Store Connect’te bu bundle id ile uygulama yok.', next: 'appstoreconnect.apple.com üzerinde uygulamayı oluşturun (API ile oluşturulamaz), sonra yeniden deneyin.' }],
  [/Run the prepare step first/i, { title: 'Sertifika ve profil hazır değil.', next: '“Sertifika ve profil” adımını çalıştırın.' }],
  [/openssl was not found|openssl.*bulunamad/i, { title: 'openssl bulunamadı.', next: 'openssl paketini kurun (Linux Mint: sudo apt install openssl).' }],
  [/eşleşmiyor|does not match/i, { title: 'Profil bundle id ile eşleşmiyor.', next: 'Yayın ayarlarındaki bundle id’nin xtool.yml ile aynı olduğunu kontrol edin.' }],
  [/ENTITY_ERROR|already exists|limit/i, { title: 'Apple isteği kabul etmedi (çakışma ya da sınır).', next: 'Hesapta çok fazla dağıtım sertifikası olabilir; gereksizleri App Store Connect’ten kendiniz iptal edin (Studio hiçbir şeyi iptal etmez).' }],
  [/SHA-256/i, { title: 'İndirilen dosya doğrulanamadı.', next: 'Ağınızı kontrol edip yeniden deneyin; dosya kullanılmadı.' }],
  [/zaman aşım|timed out|timeout/i, { title: 'İşlem zaman aşımına uğradı.', next: 'Bağlantıyı kontrol edin; yükleme sürüyorsa App Store Connect’te durumu kontrol edin.' }],
  [/\b429\b|RATE_LIMIT/i, { title: 'Apple istek sınırına takıldınız.', next: 'Birkaç dakika bekleyip yeniden deneyin.' }],
  [/Missing icon|90022|90023/i, { title: 'Apple simge eksikliği bildirdi.', next: 'Linux’ta Assets.car üretilemiyor (RISKS R-15); simge sorunları ancak App Store Connect işlemesinde görülür.' }],
];

export function explainError(message: string): Explained {
  for (const [re, e] of RULES) if (re.test(message)) return e;
  return { title: 'İşlem başarısız oldu.', next: 'Ayrıntılar için çıktıyı inceleyin.' };
}
