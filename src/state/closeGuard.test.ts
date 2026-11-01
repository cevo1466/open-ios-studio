import { describe, expect, it } from 'vitest';
import { dirtyTabs, saveAllDirty } from './closeGuard';
import type { Tab } from './store';

const tab = (path: string, content: string, saved: string): Tab => ({ path, content, saved, rev: 1 });

describe('closeGuard', () => {
  it('finds only dirty tabs', () => {
    expect(dirtyTabs([tab('a', 'x', 'x'), tab('b', 'y', 'z')]).map((t) => t.path)).toEqual(['b']);
  });

  it('saves all dirty tabs and reports failures without stopping', async () => {
    const writes: string[] = [];
    const r = await saveAllDirty([tab('a', '1', '0'), tab('b', '2', '0'), tab('c', '3', '3')], async (p) => {
      if (p === 'a') throw new Error('disk full');
      writes.push(p);
    });
    expect(writes).toEqual(['b']);
    expect(r.saved.map((s) => s.path)).toEqual(['b']);
    expect(r.failed).toEqual([{ path: 'a', error: 'Error: disk full' }]);
  });
});
