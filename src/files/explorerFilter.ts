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
export const isHiddenName = (name: string): boolean => HIDDEN_NAMES.has(name);

/**
 * Splits one directory listing. Build artifacts are separated only at the project root, where
 * they appear; deeper levels only drop hidden noise.
 */
export function partitionEntries(entries: Entry[], atRoot: boolean): Partition {
  const out: Partition = { primary: [], artifacts: [], hidden: [] };
  for (const e of entries) {
    if (isHiddenName(e.name)) out.hidden.push(e);
    else if (atRoot && e.isDir && isArtifactDir(e.name)) out.artifacts.push(e);
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
