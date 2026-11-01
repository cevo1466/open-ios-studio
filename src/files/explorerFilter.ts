import type { Entry } from '../ipc';

/** Folders that hold build output. Shown only inside the collapsed "Build çıktıları" group. */
export const ARTIFACT_DIRS = ['.build', '.swiftpm', 'DerivedData', 'xtool', 'build', 'dist', 'out', 'Pods'];
/** Noise that is hidden unless the user asks for hidden items. */
const HIDDEN_NAMES = new Set(['.git', '.DS_Store', 'node_modules', '.idea', '.vscode', '.gitignore', '.gitattributes']);

export interface Partition {
  primary: Entry[];
  artifacts: Entry[];
  hidden: Entry[];
}

export const isArtifactDir = (name: string): boolean => ARTIFACT_DIRS.includes(name);
/** Dot-files and dot-folders (.git, .bsp, .gitignore …) are tool noise for a beginner. */
export const isHiddenName = (name: string): boolean => name.startsWith('.') || HIDDEN_NAMES.has(name);

/**
 * Splits one directory listing. Build artifacts are separated only at the project root, where
 * they appear; deeper levels only drop hidden noise.
 */
export function partitionEntries(entries: Entry[], atRoot: boolean): Partition {
  const out: Partition = { primary: [], artifacts: [], hidden: [] };
  for (const e of entries) {
    if (atRoot && e.isDir && isArtifactDir(e.name)) out.artifacts.push(e);
    else if (isHiddenName(e.name)) out.hidden.push(e);
    else out.primary.push(e);
  }
  return out;
}

/** Project files a beginner looks for first. They are listed before everything else at the root. */
const PINNED = ['Package.swift', 'xtool.yml', 'Sources', 'Resources', 'Assets.xcassets'];

export function sortRoot(entries: Entry[]): Entry[] {
  const rank = (e: Entry) => {
    const i = PINNED.indexOf(e.name);
    return i === -1 ? PINNED.length : i;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

export interface EntryNote {
  /** Short caption shown next to the name. */
  label: string;
  /** Longer explanation for the tooltip. */
  title: string;
}

const NOTES: Record<string, EntryNote> = {
  'Package.swift': { label: 'paket tanımı', title: 'Swift paket tanımı: uygulamanın adı, hedefleri ve bağımlılıkları.' },
  'xtool.yml': { label: 'xtool ayarı', title: 'xtool ayarları: uygulama kimliği (bundle id) ve imzalama bilgileri.' },
  Sources: { label: 'kodlarınız', title: 'Kaynak kodlarınız burada. Swift dosyalarını bu klasörde düzenlersiniz.' },
  Resources: { label: 'görseller', title: 'Görseller ve diğer kaynak dosyaları.' },
  'Assets.xcassets': { label: 'görseller', title: 'Uygulama simgesi ve görseller.' },
  'Info.plist': { label: 'uygulama bilgisi', title: 'Uygulama bilgi dosyası.' },
};

/** What a well-known project entry is for, shown at the project root so beginners know where to look. */
export function entryNote(name: string): EntryNote | null {
  return NOTES[name] ?? null;
}

const ARTIFACT_NOTES: Record<string, string> = {
  '.build': 'Swift derleme önbelleği. Derleyince kendiliğinden oluşur.',
  '.swiftpm': 'Swift paket yöneticisinin geçici dosyaları.',
  xtool: 'xtool çıktısı: derlenen uygulama paketi (.app) burada oluşur.',
  DerivedData: 'Derleme ara dosyaları.',
  build: 'Derleme çıktısı.',
  dist: 'Dağıtım çıktısı.',
  out: 'Derleme çıktısı.',
  Pods: 'Bağımlılık klasörü.',
};

export function artifactNote(name: string): string | null {
  return ARTIFACT_NOTES[name] ?? null;
}
