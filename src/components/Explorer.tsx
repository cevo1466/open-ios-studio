import { useCallback, useEffect, useState } from 'react';
import { ipc, type Entry } from '../ipc';

interface Props {
  root: string;
  refreshKey: number;
  activePath: string | null;
  onOpen: (path: string) => void;
  onError: (message: string) => void;
}

export function Explorer({ root, refreshKey, activePath, onOpen, onError }: Props) {
  return (
    <ul className="tree" role="tree" aria-label={`Files in ${root}`}>
      <Level dir="" depth={0} refreshKey={refreshKey} activePath={activePath} onOpen={onOpen} onError={onError} />
    </ul>
  );
}

interface LevelProps extends Omit<Props, 'root'> {
  dir: string;
  depth: number;
}

function Level({ dir, depth, refreshKey, activePath, onOpen, onError }: LevelProps) {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .listDir(dir)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) onError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [dir, refreshKey, onError]);

  if (entries === null) return <li className="tree-note">Loading…</li>;
  if (entries.length === 0 && depth === 0) return <li className="tree-note">This folder is empty.</li>;
  return (
    <>
      {entries.map((entry) => (
        <Node
          key={entry.path}
          entry={entry}
          depth={depth}
          refreshKey={refreshKey}
          activePath={activePath}
          onOpen={onOpen}
          onError={onError}
        />
      ))}
    </>
  );
}

function Node({
  entry,
  depth,
  ...rest
}: { entry: Entry; depth: number } & Omit<LevelProps, 'dir' | 'depth'>) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => {
    if (entry.isDir) setOpen((v) => !v);
    else rest.onOpen(entry.path);
  }, [entry, rest]);

  return (
    <li role="treeitem" aria-expanded={entry.isDir ? open : undefined} aria-selected={rest.activePath === entry.path}>
      <button
        type="button"
        className={`tree-row${rest.activePath === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
      >
        <span aria-hidden="true" className="tree-icon">
          {entry.isDir ? (open ? '▾' : '▸') : '·'}
        </span>
        {entry.name}
      </button>
      {entry.isDir && open && (
        <ul role="group">
          <Level dir={entry.path} depth={depth + 1} {...rest} />
        </ul>
      )}
    </li>
  );
}
