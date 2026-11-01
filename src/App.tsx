import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { CommandPalette, type Command } from './components/CommandPalette';
import { EditorPane } from './components/EditorPane';
import { Explorer } from './components/Explorer';
import { useAi } from './ai/useAi';
import { BuildPanel } from './components/BuildPanel';
import { TERMINAL_TITLES, TerminalPanel } from './components/TerminalPanel';
import { BottomPanel, type BottomTab, type BottomTabId } from './layout/BottomPanel';
import { Splitter } from './layout/Splitter';
import './layout/layout.css';
import { AI_DEFAULT, AI_MAX, AI_MIN, BOTTOM_DEFAULT, BOTTOM_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, bottomMax, loadLayout, saveLayout, type LayoutState } from './layout/layout';
import { CLI_TERMINAL_KIND } from './ai/cli';
import type { PtyKind } from './ai/types';
import { ChatPanel } from './components/ChatPanel';
import { DevicesPanel } from './components/DevicesPanel';
import { AppStoreReadiness, SecurityCenter } from './components/PolicyPanels';
import { CloseGuardDialog } from './components/CloseGuard';
import { WelcomeScreen } from './components/WelcomeScreen';
import { SettingsDialog } from './components/SettingsDialog';
import { dirtyTabs, saveAllDirty } from './state/closeGuard';
import { inDesktopApp, ipc } from './ipc';
import { effectiveTheme, loadSettings, saveSettings, type Settings } from './settings';
import { analyzeProject } from './policy';
import type { EvaluationReport } from './policy/types';
import { initialState, isDirty, reducer } from './state/store';
import { buildReducer, initialBuildState } from './xtool/buildState';
import { buildOutcome, compatibility, parseAuthStatus, parseDevices, parseDiagnostics, parseSwiftVersion, parseXtoolVersion, redactLine } from './xtool/parse';
import type { Device, RunEvent, XtoolInfo, XtoolOp, XtoolRunArgs } from './xtool/types';

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic API)',
  openai: 'OpenAI (API)',
  ollama: 'Ollama (yerel)',
  'claude-cli': 'Claude (abonelik)',
  'codex-cli': 'Codex (ChatGPT aboneliği)',
};

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
  const [buildOpen, setBuildOpen] = useState(false);
  const [terminal, setTerminal] = useState<{ kind: PtyKind; key: number } | null>(null);
  const [layout, setLayout] = useState<LayoutState>(loadLayout);
  const [bottomActive, setBottomActive] = useState<BottomTabId>('terminal');
  const [bottomHidden, setBottomHidden] = useState(false);
  const [bottomMaximized, setBottomMaximized] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => saveLayout(layout), [layout]);
  const commitLayout = useCallback((patch: Partial<LayoutState>) => setLayout((l) => ({ ...l, ...patch })), []);
  /** Live drag: set the CSS variable directly so the app does not re-render on every pointer move. */
  const liveVar = useCallback((name: string, value: number) => appRef.current?.style.setProperty(name, `${value}px`), []);
  const showBottom = useCallback((id: BottomTabId) => {
    setBottomActive(id);
    setBottomHidden(false);
  }, []);
  const openTerminal = (kind: PtyKind) => {
    // The plain shell is reused if it is already running; login commands always start fresh.
    setTerminal((t) => (kind === 'user-shell' && t?.kind === 'user-shell' ? t : { kind, key: (t?.key ?? 0) + 1 }));
    showBottom('terminal');
  };
  const [build, buildDispatch] = useReducer(buildReducer, initialBuildState);
  const [xtoolInfo, setXtoolInfo] = useState<XtoolInfo | null>(null);
  const [xtoolLoading, setXtoolLoading] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [authText, setAuthText] = useState<string | null>(null);
  const [authLoggedIn, setAuthLoggedIn] = useState<boolean | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [selectedUdid, setSelectedUdid] = useState<string | null>(null);
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
        fail(`Dosya açılamadı (${path}): ${String(e)}`);
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
      fail(`Kaydedilemedi (${tab.path}): ${String(e)}`);
    }
  }, [state.tabs, state.active, fail]);

  const runAnalysis = useCallback(async () => {
    setAnalysisError(null);
    if (!state.workspace) {
      setAnalysisError('Önce bir klasör açın: analiz, açık projenin dosyalarını okur.');
      return;
    }
    setAnalysing(true);
    try {
      const scan = await ipc.scanWorkspace();
      setReport(analyzeProject(scan.files));
      if (scan.truncated) setAnalysisError('Tarama sınırına ulaşıldı: bazı dosyalar analiz edilmedi, sonuçlar eksik.');
    } catch (e) {
      setAnalysisError(String(e));
    } finally {
      setAnalysing(false);
    }
  }, [state.workspace]);

  const detectXtool = useCallback(async () => {
    setXtoolLoading(true);
    try {
      setXtoolInfo(await ipc.xtoolDetect());
    } catch (e) {
      setXtoolInfo({ found: false, path: null, versionOutput: null, swiftVersionOutput: null, error: String(e) });
    } finally {
      setXtoolLoading(false);
    }
  }, []);

  const runXtool = useCallback(
    async (op: XtoolOp, args: XtoolRunArgs) => {
      buildDispatch({ type: 'start', op });
      const onEvent = (event: RunEvent) =>
        buildDispatch({ type: 'event', event: event.kind === 'line' ? { ...event, text: redactLine(event.text) } : event });
      try {
        await ipc.xtoolRun(op, args, onEvent);
        if (op === 'new') setRefreshKey((k) => k + 1);
      } catch (e) {
        onEvent({ kind: 'line', stream: 'stderr', text: String(e) });
        onEvent({ kind: 'exit', code: null, cancelled: false, timedOut: false, droppedLines: 0 });
      }
    },
    [],
  );

  /** Run a short xtool operation and return its output without touching the build log. */
  const collectXtool = useCallback(async (op: XtoolOp, args: XtoolRunArgs = {}) => {
    const lines: string[] = [];
    let code: number | null = null;
    await ipc.xtoolRun(op, args, (e) => {
      if (e.kind === 'line') lines.push(redactLine(e.text));
      else code = e.code;
    });
    return { text: lines.join('\n'), code };
  }, []);

  const refreshDevices = useCallback(async () => {
    setDevicesError(null);
    if (state.workspace === null) {
      setDevicesError('Önce bir klasör açın: xtool çalışma klasörünüzün içinde çalışır.');
      return;
    }
    setDevicesLoading(true);
    try {
      const info = xtoolInfo ?? (await ipc.xtoolDetect());
      setXtoolInfo(info);
      if (!info.found) {
        setDevices([]);
        return;
      }
      const auth = await collectXtool('auth-status');
      const parsedAuth = parseAuthStatus(auth.text);
      setAuthText(parsedAuth.detail);
      setAuthLoggedIn(auth.code === 0 ? parsedAuth.loggedIn : null);
      const listed = await collectXtool('devices');
      if (listed.code !== 0) throw new Error(listed.text || 'xtool devices failed');
      setDevices(parseDevices(listed.text));
    } catch (e) {
      setDevices(null);
      setDevicesError(String(e));
    } finally {
      setDevicesLoading(false);
    }
  }, [state.workspace, xtoolInfo, collectXtool]);

  const openDevices = useCallback(() => {
    setBuildOpen(false);
    setDevicesOpen(true);
    showBottom('devices');
    void refreshDevices();
  }, [refreshDevices, showBottom]);

  useEffect(() => {
    if (!desktop) return;
    ipc
      .xtoolDetect()
      .then(setXtoolInfo)
      .catch(() => {
        /* the Build panel shows the detection error when opened */
      });
  }, [desktop]);

  const openBuild = useCallback(() => {
    setDevicesOpen(false);
    setBuildOpen(true);
    showBottom('build');
    if (xtoolInfo === null) void detectXtool();
  }, [xtoolInfo, detectXtool, showBottom]);

  const diagnostics = useMemo(() => parseDiagnostics(build.lines.map((l) => l.text)), [build.lines]);
  const parsedVersion = parseXtoolVersion(xtoolInfo?.versionOutput ?? '');
  const outcomeLabel = useMemo(() => {
    if (!build.outcome) return null;
    const o = buildOutcome(build.outcome, diagnostics);
    return `${o.status.replace('_', ' ')} · ${o.errorCount} error(s), ${o.warningCount} warning(s)`;
  }, [build.outcome, diagnostics]);

  const [chatOpen, setChatOpen] = useState(false);
  const buildFailed = build.outcome !== null && build.outcome.code !== 0;
  const dirtyPaths = useMemo(() => state.tabs.filter(isDirty).map((t) => t.path), [state.tabs]);
  const openPaths = useMemo(() => state.tabs.map((t) => t.path), [state.tabs]);

  const onApplied = useCallback(async (paths: string[]) => {
    setRefreshKey((k) => k + 1);
    for (const path of paths) {
      try {
        const content = await ipc.readFile(path);
        dispatch({ type: 'reloaded', path, content });
      } catch {
        /* file not open or unreadable: the explorer refresh is enough */
      }
    }
  }, []);

  const ai = useAi({
    workspace: state.workspace,
    openPaths,
    activePath: state.active,
    dirtyPaths,
    diagnostics,
    buildFailed,
    onApplied: (paths) => void onApplied(paths),
  });

  const toggleBottomRef = useRef<() => void>(() => undefined);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const closeTab = useCallback(
    (path: string) => {
      const tab = state.tabs.find((t) => t.path === path);
      if (tab && isDirty(tab) && !window.confirm(`${path} dosyasında kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?`)) return;
      dispatch({ type: 'close', path });
    },
    [state.tabs],
  );

  const tabsRef = useRef(state.tabs);
  useEffect(() => {
    tabsRef.current = state.tabs;
  }, [state.tabs]);
  const [closePrompt, setClosePrompt] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Ask before the window closes with unsaved changes (desktop app only).
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
          if (dirtyTabs(tabsRef.current).length > 0) {
            event.preventDefault();
            setClosePrompt(true);
          }
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* window API unavailable: closing is not guarded */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktop]);

  const forceClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().destroy();
    } catch (e) {
      setCloseBusy(false);
      setCloseError(`Pencere kapatılamadı: ${String(e)}`);
    }
  };

  const saveAndClose = async () => {
    setCloseBusy(true);
    setCloseError(null);
    const result = await saveAllDirty(state.tabs, ipc.writeFile);
    for (const s of result.saved) dispatch({ type: 'saved', path: s.path, content: s.content });
    if (result.failed.length > 0) {
      setCloseBusy(false);
      setCloseError(`Kaydedilemedi: ${result.failed.map((f) => `${f.path} (${f.error})`).join(', ')}`);
      return;
    }
    await forceClose();
  };

  const discardAndClose = () => {
    setCloseBusy(true);
    void forceClose();
  };

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
        fail(`Dosya oluşturulamadı (${path}): ${String(e)}`);
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
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleBottomRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasWorkspace = state.workspace !== null;
  const commands: Command[] = useMemo(
    () => [
      { id: 'open', title: 'Klasör aç…', enabled: desktop, run: () => void openFolder() },
      { id: 'new', title: 'Yeni dosya…', enabled: hasWorkspace, run: () => setNewName('') },
      { id: 'save', title: 'Dosyayı kaydet', enabled: hasWorkspace, hint: 'Ctrl+S', run: () => void saveRef.current() },
      { id: 'settings', title: 'Ayarları aç', enabled: true, run: () => setShowSettings(true) },
      { id: 'panel', title: 'Alt paneli göster/gizle', enabled: desktop, hint: 'Ctrl+J', run: () => toggleBottomRef.current() },
      {
        id: 'theme',
        title: 'Açık/koyu temayı değiştir',
        enabled: true,
        run: () => setSettings((s) => ({ ...s, theme: theme === 'dark' ? 'light' : 'dark' })),
      },
    ],
    [desktop, hasWorkspace, openFolder, theme],
  );

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const bottomTabs: BottomTab[] = [];
  if (terminal) {
    bottomTabs.push({
      id: 'terminal',
      label: TERMINAL_TITLES[terminal.kind],
      content: (
        <TerminalPanel
          kind={terminal.kind}
          runKey={terminal.key}
          theme={theme}
          onExit={() => ai.refreshCli()}
          onClose={() => {
            setTerminal(null);
            ai.refreshCli();
          }}
        />
      ),
    });
  }
  if (buildOpen) {
    bottomTabs.push({
      id: 'build',
      label: 'Derleme',
      badge: build.running ? 'çalışıyor' : errorCount > 0 ? `${errorCount} hata` : warningCount > 0 ? `${warningCount} uyarı` : undefined,
      tone: build.running ? 'busy' : errorCount > 0 ? 'error' : warningCount > 0 ? 'warn' : undefined,
      content: (
        <BuildPanel
          info={xtoolInfo}
          infoLoading={xtoolLoading}
          compatibility={compatibility(parsedVersion)}
          versionLabel={parsedVersion.value ?? (xtoolInfo?.versionOutput ?? null)}
          swiftLabel={parseSwiftVersion(xtoolInfo?.swiftVersionOutput ?? '')}
          hasWorkspace={hasWorkspace}
          state={build}
          diagnostics={diagnostics}
          outcomeLabel={outcomeLabel}
          onRedetect={() => void detectXtool()}
          onRun={(op, args) => void runXtool(op, args)}
          onCancel={() => void ipc.xtoolCancel()}
          onClose={() => setBuildOpen(false)}
          onOpenFile={(path) => void openFile(path)}
        />
      ),
    });
  }
  if (devicesOpen) {
    bottomTabs.push({
      id: 'devices',
      label: 'Cihazlar',
      content: (
        <DevicesPanel
          xtoolFound={xtoolInfo?.found === true}
          devices={devices}
          authText={authText}
          authLoggedIn={authLoggedIn}
          loading={devicesLoading}
          error={devicesError}
          hasWorkspace={hasWorkspace}
          running={build.running}
          selectedUdid={selectedUdid}
          onSelect={setSelectedUdid}
          onRefresh={() => void refreshDevices()}
          onRunOnDevice={(udid, configuration) => {
            setDevicesOpen(false);
            setBuildOpen(true);
            showBottom('build');
            void runXtool('run-device', { configuration, udid: udid ?? undefined });
          }}
          onLaunch={(udid, bundleId) => {
            setDevicesOpen(false);
            setBuildOpen(true);
            showBottom('build');
            void runXtool('launch', { bundleId, udid: udid ?? undefined });
          }}
          onClose={() => setDevicesOpen(false)}
        />
      ),
    });
  }
  const activeBottom: BottomTabId | undefined = bottomTabs.some((t) => t.id === bottomActive) ? bottomActive : bottomTabs[0]?.id;
  const bottomVisible = bottomTabs.length > 0 && !bottomHidden;
  useEffect(() => {
    toggleBottomRef.current = () => {
      if (bottomTabs.length === 0) {
        if (desktop) openTerminal('user-shell');
        return;
      }
      setBottomHidden((h) => !h);
    };
  });
  const layoutVars = {
    '--sidebar-w': `${layout.sidebarWidth}px`,
    '--bottom-h': `${layout.bottomHeight}px`,
    '--ai-w': `${layout.aiWidth}px`,
  } as CSSProperties;

  return (
    <div className="app" ref={appRef} style={layoutVars}>
      {!desktop && (
        <div className="banner" role="alert">
          Tarayıcıda çalışıyor: dosya erişimi yok. Masaüstü uygulamasını kullanın.
        </div>
      )}
      <div className="body">
        <nav className="activity" aria-label="Bölümler">
          <button type="button" className="act active" aria-current="page" title="Proje dosyaları">
            Dosyalar
          </button>
          <button type="button" className="act" onClick={openBuild} disabled={!desktop} title={desktop ? 'xtool ile derle' : 'Yalnızca masaüstü uygulaması'}>
            Derle
            <small>xtool</small>
          </button>
          <button type="button" className="act" onClick={openDevices} disabled={!desktop} title={desktop ? 'Bağlı iPhone\'lar ve imza durumu' : 'Yalnızca masaüstü uygulaması'}>
            Cihazlar
            <small>iPhone</small>
          </button>
          <button type="button" className="act" onClick={() => setChatOpen(true)} disabled={!desktop} title={desktop ? 'Yapay zekâ asistanı' : 'Yalnızca masaüstü uygulaması'}>
            Yapay zekâ
            <small>Claude · Codex · OpenAI · Ollama</small>
          </button>
          <button type="button" className="act" onClick={() => openTerminal('user-shell')} disabled={!desktop} title={desktop ? 'Gömülü terminal' : 'Yalnızca masaüstü uygulaması'}>
            Terminal
            <small>kendi kabuğunuz</small>
          </button>
          <button type="button" className="act" onClick={() => setPanel('asr')}>
            App Store hazırlığı
            <small>kaynak denetimi</small>
          </button>
          <button type="button" className="act" onClick={() => setPanel('msec')}>
            Güvenlik merkezi
            <small>kaynak denetimi</small>
          </button>
          <button type="button" className="act bottom" onClick={() => setShowSettings(true)}>
            Ayarlar
          </button>
        </nav>

        <aside className="sidebar" aria-label="Dosya gezgini">
          <div className="side-head">
            <strong>{state.workspace ? state.workspace.split('/').pop() : 'Dosyalar'}</strong>
            <span>
              <button type="button" onClick={() => void openFolder()} disabled={!desktop}>
                Klasör aç
              </button>
              <button type="button" onClick={() => setNewName('')} disabled={!hasWorkspace}>
                Yeni dosya
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
                placeholder="Sources/Uygulama/Ekran.swift"
                aria-label="Yeni dosya yolu"
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
            <p className="muted pad">Başlamak için bir klasör açın.</p>
          )}
        </aside>
        <Splitter
          orientation="vertical"
          direction={1}
          label="Dosya gezgini genişliği"
          value={layout.sidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          onLive={(v) => liveVar('--sidebar-w', v)}
          onCommit={(v) => commitLayout({ sidebarWidth: v })}
          onReset={() => {
            liveVar('--sidebar-w', SIDEBAR_DEFAULT);
            commitLayout({ sidebarWidth: SIDEBAR_DEFAULT });
          }}
        />

        <main className={`main${bottomVisible && bottomMaximized ? ' bottom-max' : ''}`} ref={mainRef}>
          <div className="editor-region">
          {notice && (
            <div className="notice" role="alert">
              {notice}
              <button type="button" onClick={() => setNotice(null)} aria-label="Kapat">
                ×
              </button>
            </div>
          )}
          {state.tabs.length === 0 ? (
            <WelcomeScreen
              desktop={desktop}
              workspace={state.workspace}
              xtoolFound={xtoolInfo ? xtoolInfo.found : null}
              aiProviderLabel={PROVIDER_LABELS[ai.settings.provider] ?? ai.settings.provider}
              aiReady={ai.cliProvider ? (ai.cliStatus ? ai.cliStatus.loggedIn : null) : ai.needsKey ? ai.keyStored : true}
              onOpenFolder={() => void openFolder()}
              onNewFile={() => setNewName('')}
              onOpenAi={() => setChatOpen(true)}
              onOpenBuild={openBuild}
              onOpenAppStore={() => setPanel('asr')}
            />
          ) : (
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
          )}
          </div>
          {buildOpen && ai.repairAvailable && (
            <div className="notice" role="status">
              Derleme başarısız oldu. Yapay zekâ en küçük düzeltmeyi önerebilir; hiçbir şey yazılmadan önce siz incelersiniz.
              <button type="button" onClick={ai.repair}>
                Yapay zekâdan düzeltmesini iste ({ai.repairAttempt + 1}/3)
              </button>
            </div>
          )}
          {bottomTabs.length > 0 && activeBottom && (
            <>
              {bottomVisible && !bottomMaximized && (
                <Splitter
                  orientation="horizontal"
                  direction={-1}
                  label="Alt panel yüksekliği"
                  value={layout.bottomHeight}
                  min={BOTTOM_MIN}
                  max={() => bottomMax(mainRef.current?.clientHeight ?? window.innerHeight)}
                  onLive={(v) => liveVar('--bottom-h', v)}
                  onCommit={(v) => commitLayout({ bottomHeight: v })}
                  onReset={() => {
                    liveVar('--bottom-h', BOTTOM_DEFAULT);
                    commitLayout({ bottomHeight: BOTTOM_DEFAULT });
                  }}
                />
              )}
              <section className="bottom-panel" hidden={!bottomVisible} aria-label="Alt panel">
                <BottomPanel
                  tabs={bottomTabs}
                  active={activeBottom}
                  maximized={bottomMaximized}
                  onSelect={setBottomActive}
                  onCloseTab={(id) => {
                    if (id === 'terminal') {
                      setTerminal(null);
                      ai.refreshCli();
                    } else if (id === 'build') setBuildOpen(false);
                    else setDevicesOpen(false);
                  }}
                  onToggleMaximize={() => setBottomMaximized((m) => !m)}
                  onHide={() => setBottomHidden(true)}
                />
              </section>
            </>
          )}
        </main>
        {chatOpen && (
          <Splitter
            orientation="vertical"
            direction={-1}
            label="Yapay zekâ paneli genişliği"
            value={layout.aiWidth}
            min={AI_MIN}
            max={AI_MAX}
            onLive={(v) => liveVar('--ai-w', v)}
            onCommit={(v) => commitLayout({ aiWidth: v })}
            onReset={() => {
              liveVar('--ai-w', AI_DEFAULT);
              commitLayout({ aiWidth: AI_DEFAULT });
            }}
          />
        )}
        {chatOpen && (
          <aside className="ai-dock" aria-label="Yapay zekâ asistanı">
            <ChatPanel
              state={ai.chat}
              settings={ai.settings}
              keyStored={ai.keyStored}
              models={ai.models}
              modelsLoading={ai.modelsLoading}
              modelsError={ai.modelsError}
              contextSummary={ai.contextSummary}
              hasWorkspace={hasWorkspace}
              theme={theme}
              onSettings={ai.setSettings}
              onSetKey={ai.setKey}
              onDeleteKey={ai.deleteKey}
              onRefreshModels={ai.refreshModels}
              onSend={ai.send}
              onStop={ai.stop}
              onDecide={ai.decide}
              onDecideAll={ai.decideAll}
              onApply={ai.apply}
              applying={ai.applying}
              applyBlockedReason={ai.applyBlockedReason}
              keyringError={ai.keyringError}
              cliProvider={ai.cliProvider}
              cliStatus={ai.cliStatus}
              cliError={ai.cliError}
              onRefreshCli={ai.refreshCli}
              onLoginEmbedded={() => ai.cliProvider && openTerminal(CLI_TERMINAL_KIND[ai.cliProvider])}
              onLoginSystem={ai.openSystemLogin}
              onClose={() => setChatOpen(false)}
            />
          </aside>
        )}
      </div>
      <footer className="status">
        <span>{state.workspace ?? 'Klasör açık değil'}</span>
        <span className="status-right">
          {bottomTabs.length > 0 && (
            <button type="button" className="status-btn" onClick={() => toggleBottomRef.current()} aria-pressed={bottomVisible}>
              {bottomVisible ? 'Paneli gizle' : 'Paneli göster'}
            </button>
          )}
          Ctrl+Shift+P: komutlar · Ctrl+J: panel · Ctrl+S: kaydet
        </span>
      </footer>
      {closePrompt && (
        <CloseGuardDialog
          dirty={dirtyTabs(state.tabs)}
          busy={closeBusy}
          error={closeError}
          onSaveAndClose={() => void saveAndClose()}
          onDiscardAndClose={discardAndClose}
          onCancel={() => {
            setClosePrompt(false);
            setCloseError(null);
          }}
        />
      )}
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
