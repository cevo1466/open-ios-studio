/** Icon step: the app icon must be a 1024×1024 PNG without an alpha channel (App Store rule). */
import type { StepResult } from './types';

export interface PngHeader {
  width: number;
  height: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 indexed, 4 grey+alpha, 6 RGBA. */
  colorType: number;
}

/** Short string for the fingerprint, e.g. `1024x1024:2`; `none` when the file is missing. */
export function iconHeaderString(header: PngHeader | null): string {
  return header ? `${header.width}x${header.height}:${header.colorType}` : 'none';
}

export function checkIcon(header: PngHeader | null, iconPath: string): StepResult {
  if (!header) {
    return { id: 'icon', status: 'FAIL', summary: `${iconPath} bulunamadı veya PNG değil.`, details: ['1024×1024, alfa kanalsız bir PNG gerekir (xtool.yml iconPath).'] };
  }
  const details: string[] = [];
  if (header.width !== 1024 || header.height !== 1024) details.push(`Boyut ${header.width}×${header.height}; App Store 1024×1024 ister.`);
  if (header.colorType === 4 || header.colorType === 6) details.push('Alfa kanalı var (colorType ' + header.colorType + '); App Store alfa kanalsız PNG ister.');
  if (header.colorType === 3) details.push('İndeksli renk (colorType 3); RGB olarak dışa aktarın.');
  if (details.length > 0) return { id: 'icon', status: 'FAIL', summary: `${iconPath} App Store simge kurallarına uymuyor.`, details };
  return { id: 'icon', status: 'PASS', summary: `${iconPath}: 1024×1024 PNG, alfa yok.`, details: [] };
}
