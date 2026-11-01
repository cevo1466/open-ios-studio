import type { Tab } from './store';

/** Tabs whose content differs from the last saved snapshot. */
export const dirtyTabs = (tabs: Tab[]): Tab[] => tabs.filter((t) => t.content !== t.saved);

export interface SaveAllResult {
  saved: { path: string; content: string }[];
  failed: { path: string; error: string }[];
}

/** Writes every dirty tab; keeps going after a failure so the user sees all problems at once. */
export async function saveAllDirty(
  tabs: Tab[],
  write: (path: string, content: string) => Promise<void>,
): Promise<SaveAllResult> {
  const result: SaveAllResult = { saved: [], failed: [] };
  for (const tab of dirtyTabs(tabs)) {
    try {
      await write(tab.path, tab.content);
      result.saved.push({ path: tab.path, content: tab.content });
    } catch (e) {
      result.failed.push({ path: tab.path, error: String(e) });
    }
  }
  return result;
}
