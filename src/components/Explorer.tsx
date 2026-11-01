import { useCallback, useEffect, useState } from 'react';
import { isBundleName } from '../files/kind';
import { partitionEntries, sortRoot } from '../files/explorerFilter';
import { ipc, type Entry } from '../ipc';

interface Props {
  root: string;
  refreshKey: number;
  activePath: string | null;
  /** Increment to expand the "Build çıktıları" group (used by the binary-file card). */
  revealArtifacts: number;
  onOpen: (path: string) => void;
  onError: (message: string) => void;
}

export function Explorer({ root, refreshKey, activePath, revealArtifacts, onOpen, onError }: Props) {
  return (
    <ul className="tree" role="tree" aria-label={`${root} içindeki dosyalar`}>
      <Level dir="" depth={0} refreshKey={refreshKey} activePath={activePath} revealArtifacts={revealArtifacts} onOpen={onOpen} onError={onError} />
    </ul>
  );
}

interface LevelProps extends Omit<Props, 'root'> {
  dir: string;
  depth: number;
}

function Level({ dir, depth, refreshKey, activePath, revealArtifacts, onOpen, onError }: LevelProps) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const atRoot = depth === 0;

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

  useEffect(() => {
    // Opening the group in response to an external request (the binary-file card).
    if (atRoot && revealArtifacts > 0) setArtifactsOpen(true);
  }, [atRoot, revealArtifacts]);

  if (entries === null) return <li className="tree-note">Yükleniyor…</li>;
  if (entries.length === 0 && atRoot) return <li className="tree-note">Bu klasör boş.</li>;

  const parts = partitionEntries(entries, atRoot);
  const primary = atRoot ? sortRoot(parts.primary) : parts.primary;
  const rest = { refreshKey, activePath, revealArtifacts, onOpen, onError };
  const renderNode = (entry: Entry) => <Node key={entry.path} entry={entry} depth={depth} {...rest} />;

  return (
    <>
      {primary.map(renderNode)}
      {atRoot && parts.artifacts.length > 0 && (
        <li className="tree-group" role="none">
          <button type="button" className="tree-group-head" aria-expanded={artifactsOpen} onClick={() => setArtifactsOpen((v) => !v)}>
            <span aria-hidden="true" className="tree-icon">
              {artifactsOpen ? '▾' : '▸'}
            </span>
            Build çıktıları
            <span className="tree-count">{parts.artifacts.length}</span>
          </button>
          {artifactsOpen && <ul role="group">{parts.artifacts.map(renderNode)}</ul>}
        </li>
      )}
      {parts.hidden.length > 0 && (
        <li className="tree-hidden" role="none">
          <button type="button" className="tree-link" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Gizli öğeleri gizle' : `Gizli öğeleri göster (${parts.hidden.length})`}
          </button>
          {showHidden && <ul role="group">{parts.hidden.map(renderNode)}</ul>}
        </li>
      )}
    </>
  );
}

function Node({ entry, depth, ...rest }: { entry: Entry; depth: number } & Omit<LevelProps, 'dir' | 'depth'>) {
  const [open, setOpen] = useState(false);
  // A .app / .framework directory is a build package: it behaves like one file, never expands.
  const bundle = entry.isDir && isBundleName(entry.name);
  const expandable = entry.isDir && !bundle;
  const toggle = useCallback(() => {
    if (expandable) setOpen((v) => !v);
    else rest.onOpen(entry.path);
  }, [entry, expandable, rest]);

  return (
    <li role="treeitem" aria-expanded={expandable ? open : undefined} aria-selected={rest.activePath === entry.path}>
      <button
        type="button"
        className={`tree-row${rest.activePath === entry.path ? ' active' : ''}${bundle ? ' bundle' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
        title={bundle ? 'Uygulama paketi (derleme çıktısı)' : undefined}
      >
        <span aria-hidden="true" className="tree-icon">
          {expandable ? (open ? '▾' : '▸') : bundle ? '◈' : '·'}
        </span>
        {entry.name}
      </button>
      {expandable && open && (
        <ul role="group">
          <Level dir={entry.path} depth={depth + 1} {...rest} />
        </ul>
      )}
    </li>
  );
}
