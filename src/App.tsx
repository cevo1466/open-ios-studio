import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CommandPalette, type Command } from './components/CommandPalette';
import { EditorPane } from './components/EditorPane';
import { Explorer } from './components/Explorer';
import { AppStoreReadiness, SecurityCenter } from './components/PolicyPanels';
import { SettingsDialog } from './components/SettingsDialog';
import { inDesktopApp, ipc } from './ipc';
import { effectiveTheme, loadSettings, saveSettings, type Settings } from './settings';
import { analyzeProject } from './policy';
import type { EvaluationReport } from './policy/types';
import { initialState, isDirty, reducer } from './state/store';

const PLANNED: { label: string; milestone: string }[] = [
  { label: 'Search', milestone: 'planned' },
  { label: 'Source Control', milestone: 'planned' },
  { label: 'AI Chat', milestone: 'M3' },
  { label: 'Build (xtool)', milestone: 'M2' },
  { label: 'Devices', milestone: 'M4' },
];

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [panel, setPanel] = useState<'asr' | 'msec' | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const desktop = inDesktopApp();

  const theme = effectiveTheme(settings.theme, prefersDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveSettings(settings);
  }, [theme, settings]);

  const fail = useCallback((message: string) => setNotice(message), []);

  const openFolder = useCallback(async () => {
    if (state.tabs.some(isDirty) && !window.confirm('Discard unsaved changes and open another folder?')) return;
    try {
      const root = await ipc.pickWorkspace();
      if (root) {
        dispatch({ type: 'workspace', root });
        setNotice(null);
      }
    } catch (e) {
      fail(String(e));
    }
  }, [state.tabs, fail]);

  const openFile = useCallback(
    async (path: string) => {
      if (state.tabs.some((t) => t.path === path)) {
        dispatch({ type: 'activate', path });
        return;
      }
      try {
        dispatch({ type: 'open', path, content: await ipc.readFile(path) });
        setNotice(null);
      } catch (e) {
        fail(`Cannot open ${path}: ${String(e)}`);
      }
    },
    [state.tabs, fail],
  );

  const save = useCallback(async () => {
    const tab = state.tabs.find((t) => t.path === state.active);
    if (!tab || !isDirty(tab)) return;
    try {
      await ipc.writeFile(tab.path, tab.content);
      dispatch({ type: 'saved', path: tab.path, content: tab.content });
      setNotice(null);
    } catch (e) {
      fail(`Cannot save ${tab.path}: ${String(e)}`);
    }
  }, [state.tabs, state.active, fail]);

  const runAnalysis = useCallback(async () => {
    setAnalysisError(null);
    if (!state.workspace) {
      setAnalysisError('Open a folder first: the analysis reads the files of the open project.');
      return;
    }
    setAnalysing(true);
    try {
      const scan = await ipc.scanWorkspace();
      setReport(analyzeProject(scan.files));
      if (scan.truncated) setAnalysisError('Scan limit reached: some files were not analysed, results are incomplete.');
    } catch (e) {
      setAnalysisError(String(e));
    } finally {
      setAnalysing(false);
    }
  }, [state.workspace]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const closeTab = useCallback(
    (path: string) => {
      const tab = state.tabs.find((t) => t.path === path);
      if (tab && isDirty(tab) && !window.confirm(`${path} has unsaved changes. Close anyway?`)) return;
      dispatch({ type: 'close', path });
    },
    [state.tabs],
  );

  const createFile = useCallback(
    async (name: string) => {
      const path = name.trim().replace(/^\/+/, '');
      setNewName(null);
      if (!path) return;
      try {
        await ipc.createFile(path);
        setRefreshKey((k) => k + 1);
        await openFile(path);
      } catch (e) {
        fail(`Cannot create ${path}: ${String(e)}`);
      }
    },
    [openFile, fail],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPalette(true);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasWorkspace = state.workspace !== null;
  const commands: Command[] = useMemo(
    () => [
      { id: 'open', title: 'Open folder…', enabled: desktop, run: () => void openFolder() },
      { id: 'new', title: 'New file…', enabled: hasWorkspace, run: () => setNewName('') },
      { id: 'save', title: 'Save file', enabled: hasWorkspace, hint: 'Ctrl+S', run: () => void saveRef.current() },
      { id: 'settings', title: 'Open settings', enabled: true, run: () => setShowSettings(true) },
      {
        id: 'theme',
        title: 'Toggle light/dark theme',
        enabled: true,
        run: () => setSettings((s) => ({ ...s, theme: theme === 'dark' ? 'light' : 'dark' })),
      },
    ],
    [desktop, hasWorkspace, openFolder, theme],
  );

  return (
    <div className="app">
      {!desktop && (
        <div className="banner" role="alert">
          Running in a plain browser: file access is unavailable. Use the desktop app.
        </div>
      )}
      <div className="body">
        <nav className="activity" aria-label="Sections">
          <button type="button" className="act active" aria-current="page" title="Explorer">
            Explorer
          </button>
          {PLANNED.map((p) => (
            <button key={p.label} type="button" className="act" disabled title={`Not available yet (${p.milestone})`}>
              {p.label}
              <small>{p.milestone}</small>
            </button>
          ))}
          <button type="button" className="act" onClick={() => setPanel('asr')}>
            App Store Readiness
            <small>static checks</small>
          </button>
          <button type="button" className="act" onClick={() => setPanel('msec')}>
            Security Center
            <small>static checks</small>
          </button>
          <button type="button" className="act bottom" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </nav>

        <aside className="sidebar" aria-label="Explorer">
          <div className="side-head">
            <strong>{state.workspace ? state.workspace.split('/').pop() : 'Explorer'}</strong>
            <span>
              <button type="button" onClick={() => void openFolder()} disabled={!desktop}>
                Open folder
              </button>
              <button type="button" onClick={() => setNewName('')} disabled={!hasWorkspace}>
                New file
              </button>
            </span>
          </div>
          {newName !== null && (
            <form
              className="new-file"
              onSubmit={(e) => {
                e.preventDefault();
                void createFile(newName);
              }}
            >
              <input
                autoFocus
                value={newName}
                placeholder="path/relative/to/folder.swift"
                aria-label="New file path"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setNewName(null)}
              />
            </form>
          )}
          {state.workspace ? (
            <Explorer
              root={state.workspace}
              refreshKey={refreshKey}
              activePath={state.active}
              onOpen={(p) => void openFile(p)}
              onError={fail}
            />
          ) : (
            <p className="muted pad">Open a folder to start. SwiftPM project creation arrives with xtool support (M2).</p>
          )}
        </aside>

        <main className="main">
          {notice && (
            <div className="notice" role="alert">
              {notice}
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
          <EditorPane
            tabs={state.tabs}
            active={state.active}
            theme={theme}
            fontSize={settings.fontSize}
            onActivate={(path) => dispatch({ type: 'activate', path })}
            onClose={closeTab}
            onChange={(path, content) => dispatch({ type: 'edit', path, content })}
            onSave={() => void saveRef.current()}
          />
        </main>
      </div>
      <footer className="status">
        <span>{state.workspace ?? 'No folder open'}</span>
        <span>Ctrl+Shift+P: commands · Ctrl+S: save</span>
      </footer>
      {showSettings && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
      {panel && (
        <PolicyPanel
          which={panel}
          report={report}
          loading={analysing}
          error={analysisError}
          onRun={() => void runAnalysis()}
          onClose={() => setPanel(null)}
        />
      )}
      {showPalette && <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />}
    </div>
  );
}

function PolicyPanel({ which, ...props }: { which: 'asr' | 'msec' } & React.ComponentProps<typeof SecurityCenter>) {
  return which === 'asr' ? <AppStoreReadiness {...props} /> : <SecurityCenter {...props} />;
}
