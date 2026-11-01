/** Decides how a workspace path may be opened. Binary output must never reach the text editor. */

export type FileKind = 'text' | 'bundle' | 'binary' | 'image';

/** Directory packages that behave like a single file (they are never expanded in the tree). */
const BUNDLE_EXT = new Set(['app', 'appex', 'framework', 'xcarchive', 'dsym', 'xctest', 'bundle']);
const BINARY_EXT = new Set([
  'ipa', 'dylib', 'a', 'o', 'so', 'exe', 'bin', 'class', 'jar', 'zip', 'gz', 'tar', 'tgz', 'xz', 'bz2', '7z',
  'car', 'nib', 'storyboardc', 'mom', 'momd', 'omo', 'mobileprovision', 'p12', 'cer', 'der', 'dmg', 'pdf',
  'ttf', 'otf', 'woff', 'woff2', 'mp3', 'mp4', 'mov', 'wav', 'swiftmodule', 'swiftdoc', 'swiftsourceinfo',
  'pcm', 'pch', 'gch', 'db', 'sqlite', 'lock-bin', 'profraw', 'profdata',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'heic', 'tiff']);

const ext = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
};

export function isBundleName(name: string): boolean {
  return BUNDLE_EXT.has(ext(name));
}

export function classifyPath(path: string): FileKind {
  const segments = path.split('/').filter(Boolean);
  if (segments.some(isBundleName)) return 'bundle';
  const last = segments[segments.length - 1] ?? '';
  const e = ext(last);
  if (IMAGE_EXT.has(e)) return 'image';
  if (BINARY_EXT.has(e)) return 'binary';
  return 'text';
}

/** True for the error text Rust returns when a file is not UTF-8. */
export function isNotTextError(message: string): boolean {
  return /not valid UTF-8/i.test(message);
}

export interface KindInfo {
  title: string;
  lead: string;
}

export function describeKind(kind: Exclude<FileKind, 'text'>): KindInfo {
  switch (kind) {
    case 'bundle':
      return {
        title: 'Uygulama paketi',
        lead: 'Bu bir derleme çıktısıdır (uygulama paketi). Kaynak kod değildir, bu yüzden metin düzenleyicide açılmaz.',
      };
    case 'image':
      return {
        title: 'Görsel dosyası',
        lead: 'Bu bir görsel dosyasıdır. Metin düzenleyicide açılmaz; dosya yöneticisinde görüntüleyebilirsiniz.',
      };
    case 'binary':
      return {
        title: 'İkili dosya',
        lead: 'Bu dosya metin değil, bir ikili çıktıdır. Metin düzenleyicide açılırsa bozuk görünür ve kaydedilirse zarar görebilir.',
      };
  }
}
