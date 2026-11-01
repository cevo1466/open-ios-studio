import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { artifactNote, entryNote, partitionEntries, sortRoot } from '../files/explorerFilter';
import { isBundleName } from '../files/kind';
import { ipc, type Entry } from '../ipc';
import { TreeConfig, TreeFile, TreeFolder, TreePackage, TreeSwift } from './icons';

interface Props {
  root: string;
  refreshKey: number;
  activePath: string | null;
  /** Increment to expand the "Build çıktıları" group (used by the binary-file card). */
  revealArtifacts: number;
  /** Increment to collapse every folder. */
  collapseKey: number;
  onOpen: (path: string) => void;
  onError: (message: string) => void;
}

export function Explorer({ root, refreshKey, activePath, revealArtifacts, collapseKey, onOpen, onError }: Props) {
  return (
    <ul className="tree" role="tree" aria-label={`${root} içindeki dosyalar`}>
      <Level dir="" depth={0} refreshKey={refreshKey} activePath={activePath} revealArtifacts={revealArtifacts} collapseKey={collapseKey} onOpen={onOpen} onError={onError} />
    </ul>
  );
}

interface LevelProps extends Omit<Props, 'root'> {
  dir: string;
  depth: number;
}

const CONFIG_EXT = new Set(['yml', 'yaml', 'json', 'plist', 'xcconfig', 'toml']);

function FileIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'swift') return <TreeSwift />;
  if (CONFIG_EXT.has(ext)) return <TreeConfig />;
  return <TreeFile />;
}

/** Folder group at the project root ("Build çıktıları", "Gizli dosyalar"). Collapsed by default. */
function Group(props: { title: string; hint: string; entries: Entry[]; open: boolean; onToggle(): void; render: (e: Entry) => React.ReactNode }) {
  return (
    <li className="tree-group" role="none">
      <button type="button" className="tree-group-head" aria-expanded={props.open} onClick={props.onToggle} title={props.hint}>
        <span aria-hidden="true" className={`tree-chev${props.open ? ' open' : ''}`} />
        {props.title}
        <span className="tree-count">{props.entries.length}</span>
      </button>
      {props.open && (
        <>
          <p className="tree-group-hint">{props.hint}</p>
          <ul role="group">{props.entries.map(props.render)}</ul>
        </>
      )}
    </li>
  );
}

function Level({ dir, depth, refreshKey, activePath, revealArtifacts, collapseKey, onOpen, onError }: LevelProps) {
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

  // Adjust state while rendering: open the artifact group on request, close groups on "collapse all".
  const [seenReveal, setSeenReveal] = useState(revealArtifacts);
  if (atRoot && revealArtifacts !== seenReveal) {
    setSeenReveal(revealArtifacts);
    if (revealArtifacts > 0) setArtifactsOpen(true);
  }
  const [seenCollapse, setSeenCollapse] = useState(collapseKey);
  if (collapseKey !== seenCollapse) {
    setSeenCollapse(collapseKey);
    setArtifactsOpen(false);
    setShowHidden(false);
  }

  if (entries === null) return <li className="tree-note">Yükleniyor…</li>;
  if (entries.length === 0 && atRoot) return <li className="tree-note">Bu klasör boş.</li>;

  const parts = partitionEntries(entries, atRoot);
  const primary = atRoot ? sortRoot(parts.primary) : parts.primary;
  const rest = { refreshKey, activePath, revealArtifacts, collapseKey, onOpen, onError };
  const renderNode = (entry: Entry) => <Node key={entry.path} entry={entry} depth={depth} atRoot={atRoot} {...rest} />;

  return (
    <>
      {primary.map(renderNode)}
      {atRoot && parts.artifacts.length > 0 && (
        <Group
          title="Build çıktıları"
          hint="Derleme sonucu kendiliğinden oluşan dosyalar. Elle düzenlemeyin; derleyince yeniden üretilir."
          entries={parts.artifacts}
          open={artifactsOpen}
          onToggle={() => setArtifactsOpen((v) => !v)}
          render={renderNode}
        />
      )}
      {parts.hidden.length > 0 && (
        <Group
          title="Gizli dosyalar"
          hint="Araçların kullandığı nokta ile başlayan dosyalar (.git, .gitignore …). Genelde dokunmanız gerekmez."
          entries={parts.hidden}
          open={showHidden}
          onToggle={() => setShowHidden((v) => !v)}
          render={renderNode}
        />
      )}
    </>
  );
}

function Node({ entry, depth, atRoot, ...rest }: { entry: Entry; depth: number; atRoot: boolean } & Omit<LevelProps, 'dir' | 'depth'>) {
  const [open, setOpen] = useState(false);
  const [seenCollapse, setSeenCollapse] = useState(rest.collapseKey);
  if (rest.collapseKey !== seenCollapse) {
    setSeenCollapse(rest.collapseKey);
    setOpen(false);
  }
  // A .app / .framework directory is a build package: it behaves like one file, never expands.
  const bundle = entry.isDir && isBundleName(entry.name);
  const expandable = entry.isDir && !bundle;
  const toggle = useCallback(() => {
    if (expandable) setOpen((v) => !v);
    else rest.onOpen(entry.path);
  }, [entry, expandable, rest]);
  const note = atRoot ? entryNote(entry.name) : null;
  const title = bundle ? 'Uygulama paketi (derleme çıktısı)' : (note?.title ?? artifactNote(entry.name) ?? undefined);
  const guide = { '--guide-x': `${8 + depth * 14 + 7}px` } as CSSProperties;

  return (
    <li role="treeitem" aria-expanded={expandable ? open : undefined} aria-selected={rest.activePath === entry.path}>
      <button
        type="button"
        className={`tree-row${rest.activePath === entry.path ? ' active' : ''}${bundle ? ' bundle' : ''}${entry.isDir ? ' dir' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
        title={title}
      >
        <span aria-hidden="true" className={expandable ? `tree-chev${open ? ' open' : ''}` : 'tree-chev-space'} />
        {bundle ? <TreePackage /> : entry.isDir ? <TreeFolder open={open} /> : <FileIcon name={entry.name} />}
        <span className="tree-name">{entry.name}</span>
        {note && (
          <span className="tree-note-inline" aria-hidden="true">
            {note.label}
          </span>
        )}
      </button>
      {expandable && open && (
        <ul role="group" className="tree-children" style={guide}>
          <Level dir={entry.path} depth={depth + 1} {...rest} />
        </ul>
      )}
    </li>
  );
}
