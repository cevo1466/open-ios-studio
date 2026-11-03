import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { CommandPalette, type Command } from './components/CommandPalette';
import { EditorPane } from './components/EditorPane';
import { Explorer } from './components/Explorer';
import { IconCollapse, IconRefresh } from './components/icons';
import { useAi } from './ai/useAi';
import { ThemeContext } from './theme/ThemeContext';
import { THEME_VAR_NAMES, resolveTheme } from './theme/themes';
import { BuildSidebar } from './components/BuildSidebar';
import { LogView } from './components/LogView';
import { ProblemsList } from './components/ProblemsList';
import { ActivityBar, type SidebarView } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import { AiSettingsPanel, PROVIDER_LABELS } from './components/AiSettingsPanel';
import { sessionState } from './ai/readiness';
import { canRunOnDevice } from './xtool/deviceView';
import { TERMINAL_TITLES, TerminalPanel } from './components/TerminalPanel';
import { BottomPanel, type BottomTab, type BottomTabId } from './layout/BottomPanel';
import { Splitter } from './layout/Splitter';
import './layout/layout.css';
import { AI_DEFAULT, AI_MAX, AI_MIN, BOTTOM_DEFAULT, BOTTOM_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, bottomMax, loadLayout, saveLayout, type LayoutState } from './layout/layout';
import { CLI_TERMINAL_KIND } from './ai/cli';
import { describeChoice } from './ai/models';
import type { PtyKind, PtyOptions, RemoteSite } from './ai/types';
import { ChatPanel } from './components/ChatPanel';
import { DevicesPanel } from './components/DevicesPanel';
import { AppStoreReadiness, SecurityCenter } from './components/PolicyPanels';
import { buildCommands } from './app/commands';
import { PreflightView, type StepProgress } from './components/PreflightView';
import { fingerprintFiles, gateInstall, iconHeaderString, readXtoolConfig, runPreflight, REPORT_JSON, REPORT_MD, type PreflightReport } from './preflight';
import { loadCatalogs } from './policy/catalog';
import { CloseGuardDialog } from './components/CloseGuard';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BinaryCard } from './components/BinaryCard';
import { classifyPath, isNotTextError, type FileKind } from './files/kind';
import { SettingsDialog } from './components/SettingsDialog';
import { dirtyTabs, saveAllDirty } from './state/closeGuard';
import { inDesktopApp, ipc } from './ipc';
import { loadSettings, saveSettings, type Settings } from './settings';
import { analyzeProject } from './policy';
import type { EvaluationReport } from './policy/types';
import { initialState, isDirty, reducer, tabToClose, VIEW_TITLE, type ViewId } from './state/store';
import { buildReducer, initialBuildState } from './xtool/buildState';
import { compatibility, parseAuthStatus, parseDevices, parseDiagnostics, parseSwiftVersion, parseXtoolVersion, redactLine } from './xtool/parse';
import type { DoctorCheck } from './xtool/doctor';
import type { Device, RunEvent, XtoolInfo, XtoolOp, XtoolRunArgs } from './xtool/types';

const SIDEBAR_TITLES: Record<SidebarView, string> = {
  files: 'Dosyalar',
  build: 'Derle',
  devices: 'Cihazlar',
  ai: 'Yapay zekâ',
};

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [collapseKey, setCollapseKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightProgress, setPreflightProgress] = useState<StepProgress>({});
  const [preflightError, setPreflightError] = useState<string | null>(null);
  /** Fingerprint of the files as they are now; compared with the report's to detect staleness. */
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  /** Output and Problems tabs are shown once something ran or the user asked for the output. */
  const [buildOpen, setBuildOpen] = useState(false);
  const [deviceLogOpen, setDeviceLogOpen] = useState(false);
  const [view, setView] = useState<SidebarView>('files');
  const [binary, setBinary] = useState<{ path: string; kind: Exclude<FileKind, 'text'>; error: string | null } | null>(null);
  const [revealArtifacts, setRevealArtifacts] = useState(0);
  const [terminal, setTerminal] = useState<{ kind: PtyKind; key: number; options?: PtyOptions } | null>(null);
  const [layout, setLayout] = useState<LayoutState>(loadLayout);
  const [bottomActive, setBottomActive] = useState<BottomTabId>('output');
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
  const openTerminal = (kind: PtyKind, options?: PtyOptions) => {
    // The plain shell is reused if it is already running; login and Claude Code sessions start fresh.
    setTerminal((t) => (kind === 'user-shell' && t?.kind === 'user-shell' ? t : { kind, options, key: (t?.key ?? 0) + 1 }));
    showBottom('terminal');
  };
  const [build, buildDispatch] = useReducer(buildReducer, initialBuildState);
  /** Build + install + launch on a device keeps its own log, shown as "Cihaz günlükleri". */
  const [deviceRun, deviceDispatch] = useReducer(buildReducer, initialBuildState);
  const [xtoolInfo, setXtoolInfo] = useState<XtoolInfo | null>(null);
  const [doctor, setDoctor] = useState<DoctorCheck[] | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const runDoctor = useCallback(async () => {
    setDoctorLoading(true);
    setDoctorError(null);
    try {
      setDoctor(await ipc.envDoctor());
    } catch (e) {
      setDoctorError(String(e));
    } finally {
      setDoctorLoading(false);
    }
  }, []);
  const [xtoolLoading, setXtoolLoading] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [authText, setAuthText] = useState<string | null>(null);
  const [authLoggedIn, setAuthLoggedIn] = useState<boolean | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [selectedUdid, setSelectedUdid] = useState<string | null>(null);
  const desktop = inDesktopApp();

  const themeDef = resolveTheme(settings.theme, prefersDark);
  const theme = themeDef.mode;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeDef.mode;
    root.dataset.palette = themeDef.id;
    for (const name of THEME_VAR_NAMES) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(themeDef.vars)) root.style.setProperty(name, value);
    saveSettings(settings);
  }, [themeDef, settings]);

  const fail = useCallback((message: string) => setNotice(message), []);

  const refreshFingerprint = useCallback(async () => {
    if (!state.workspace) {
      setCurrentFingerprint(null);
      return;
    }
    try {
      const scan = await ipc.scanWorkspace();
      const cfg = readXtoolConfig(scan.files);
      const header = await ipc.readPngHeader(cfg.iconPath).catch(() => null);
      setCurrentFingerprint(await fingerprintFiles(scan.files, iconHeaderString(header)));
    } catch {
      setCurrentFingerprint(null);
    }
  }, [state.workspace]);

  // A workspace change drops the old report, reloads the persisted one and fingerprints the files.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPreflight(null);
      setPreflightProgress({});
      setPreflightError(null);
      setCurrentFingerprint(null);
      if (!state.workspace) return;
      try {
        const json = await ipc.readFileIfExists(REPORT_JSON);
        if (!cancelled && json) {
          const parsed = JSON.parse(json) as PreflightReport;
          if (parsed && parsed.version === 1 && Array.isArray(parsed.steps)) setPreflight(parsed);
        }
      } catch {
        /* an unreadable report simply counts as "not run" */
      }
      if (!cancelled) await refreshFingerprint();
    })();
    return () => {
      cancelled = true;
    };
  }, [state.workspace, refreshFingerprint]);

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
      const kind = classifyPath(path);
      if (kind !== 'text') {
        // Build output and binaries never go to the text editor.
        setBinary({ path, kind, error: null });
        return;
      }
      setBinary(null);
      if (state.tabs.some((t) => t.path === path)) {
        dispatch({ type: 'activate', path });
        return;
      }
      try {
        dispatch({ type: 'open', path, content: await ipc.readFile(path) });
        setNotice(null);
      } catch (e) {
        if (isNotTextError(String(e))) setBinary({ path, kind: 'binary', error: null });
        else fail(`Dosya açılamadı (${path}): ${String(e)}`);
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
      void refreshFingerprint();
    } catch (e) {
      fail(`Kaydedilemedi (${tab.path}): ${String(e)}`);
    }
  }, [state.tabs, state.active, fail, refreshFingerprint]);

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

  const gateRef = useRef<{ allowed: boolean; reason: string | null }>({ allowed: false, reason: null });
  const runXtool = useCallback(
    async (op: XtoolOp, args: XtoolRunArgs) => {
      const onDevice = op === 'run-device' || op === 'launch';
      if (onDevice && !gateRef.current.allowed) {
        setNotice(gateRef.current.reason ?? 'Yayın öncesi denetim geçilmedi.');
        return;
      }
      const dispatchRun = onDevice ? deviceDispatch : buildDispatch;
      dispatchRun({ type: 'start', op });
      if (onDevice) setDeviceLogOpen(true);
      else setBuildOpen(true);
      showBottom(onDevice ? 'devicelog' : 'output');
      const onEvent = (event: RunEvent) =>
        dispatchRun({ type: 'event', event: event.kind === 'line' ? { ...event, text: redactLine(event.text) } : event });
      try {
        await ipc.xtoolRun(op, args, onEvent);
        if (op === 'new') {
          setRefreshKey((k) => k + 1);
          void refreshFingerprint();
        }
      } catch (e) {
        onEvent({ kind: 'line', stream: 'stderr', text: String(e) });
        onEvent({ kind: 'exit', code: null, cancelled: false, timedOut: false, droppedLines: 0 });
      }
    },
    [showBottom, refreshFingerprint],
  );

  /** The pre-submission check: six steps, a verdict, and the report written into the workspace. */
  const runPreflightNow = useCallback(async () => {
    if (!state.workspace) {
      setPreflightError('Önce bir klasör açın.');
      dispatch({ type: 'openView', id: 'preflight' });
      return;
    }
    setPreflightRunning(true);
    setPreflightError(null);
    setPreflightProgress({});
    dispatch({ type: 'openView', id: 'preflight' });
    try {
      const report = await runPreflight(
        {
          project: '',
          scan: () => ipc.scanWorkspace(),
          runOp: async (op, args, onLine) => {
            const lines: string[] = [];
            let code: number | null = null;
            let timedOut = false;
            let cancelled = false;
            await ipc.xtoolRun(op, args, (e) => {
              if (e.kind === 'line') {
                const text = redactLine(e.text);
                lines.push(text);
                onLine(text);
              } else {
                code = e.code;
                timedOut = e.timedOut;
                cancelled = e.cancelled;
              }
            });
            return { code, lines, timedOut, cancelled };
          },
          readPng: (path) => ipc.readPngHeader(path).catch(() => null),
          writeFile: (path, content) => ipc.applyFile(path, content),
          analyze: analyzeProject,
          rules: loadCatalogs,
          now: () => new Date().toISOString(),
        },
        (id, st) => setPreflightProgress((prev) => ({ ...prev, [id]: st })),
      );
      setPreflight(report);
      setCurrentFingerprint(report.fingerprint);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setPreflightError(String(e));
    } finally {
      setPreflightRunning(false);
    }
  }, [state.workspace]);

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
    setView('devices');
    void refreshDevices();
  }, [refreshDevices]);

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
    setView('build');
    if (xtoolInfo === null) void detectXtool();
    void refreshDevices();
  }, [xtoolInfo, detectXtool, refreshDevices]);

  const diagnostics = useMemo(() => parseDiagnostics(build.lines.map((l) => l.text)), [build.lines]);
  const parsedVersion = parseXtoolVersion(xtoolInfo?.versionOutput ?? '');

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

  /** Ctrl+W: the view in front, else the active file (dirty files still ask). */
  const closeActiveRef = useRef<() => void>(() => undefined);
  closeActiveRef.current = () => {
    const target = tabToClose(state);
    if (!target) return;
    if (target.kind === 'view') dispatch({ type: 'closeView', id: target.id });
    else closeTab(target.path);
  };
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
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeActiveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasWorkspace = state.workspace !== null;
  const commands: Command[] = useMemo(
    () =>
      buildCommands({
        desktop,
        hasWorkspace,
        chatOpen,
        terminalOpen: terminal !== null,
        actions: {
          openFolder: () => void openFolder(),
          newFile: () => setNewName(''),
          save: () => void saveRef.current(),
          settings: () => setShowSettings(true),
          togglePanel: () => toggleBottomRef.current(),
          toggleTheme: () => setSettings((s) => ({ ...s, theme: theme === 'dark' ? 'light' : 'dark' })),
          sidebar: (v) => {
            if (v === 'build') openBuild();
            else if (v === 'devices') openDevices();
            else if (v === 'ai') {
              setView('ai');
              setChatOpen(true);
            } else setView('files');
          },
          terminal: () => openTerminal('user-shell'),
          toggleChat: () => setChatOpen((v) => !v),
          openView: (id) => dispatch({ type: 'openView', id }),
          runPreflight: () => void runPreflightNow(),
          runDoctor: () => void runDoctor(),
          claudeCode: () => openClaudeCode(),
          bottom: (tab) => showBottom(tab),
          redetect: () => void detectXtool(),
        },
      }),
    // openTerminal/openClaudeCode are plain functions of the render; the list is rebuilt on these inputs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desktop, hasWorkspace, chatOpen, terminal, openFolder, theme, openBuild, openDevices, runPreflightNow, runDoctor, showBottom, detectXtool],
  );

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const anyRunning = build.running || deviceRun.running;
  const selectedDevice = devices?.find((d) => d.udid === selectedUdid) ?? (devices && devices.length === 1 ? devices[0] : null);
  const gate = gateInstall(preflight, currentFingerprint);
  gateRef.current = gate;
  const installCheck = canRunOnDevice({
    xtoolFound: xtoolInfo?.found === true,
    hasWorkspace,
    running: anyRunning,
    authLoggedIn,
    devices,
    selectedUdid,
    preflight: gate,
  });
  const showOutput = () => showBottom(deviceRun.op !== null && deviceRun.nextId >= build.nextId ? 'devicelog' : 'output');
  const session = sessionState({ provider: ai.settings.provider, keyStored: ai.keyStored, cliStatus: ai.cliStatus });

  // Bottom panel tabs, in a fixed order: Çıktı, Sorunlar, Terminal, Cihaz günlükleri.
  const bottomTabs: BottomTab[] = [];
  if (buildOpen) {
    bottomTabs.push({
      id: 'output',
      label: 'Çıktı',
      badge: build.running ? 'çalışıyor' : undefined,
      tone: build.running ? 'busy' : undefined,
      content: (
        <LogView
          state={build}
          emptyText="Henüz çıktı yok. Derle bölümünden “Derle ve Yükle” ya da “Yalnızca derle”ye basın."
          onClear={() => buildDispatch({ type: 'clear' })}
          onCancel={() => void ipc.xtoolCancel()}
        />
      ),
    });
    bottomTabs.push({
      id: 'problems',
      label: 'Sorunlar',
      badge: errorCount > 0 ? `${errorCount} hata` : warningCount > 0 ? `${warningCount} uyarı` : undefined,
      tone: errorCount > 0 ? 'error' : warningCount > 0 ? 'warn' : undefined,
      content: <ProblemsList diagnostics={diagnostics} onOpenFile={(path) => void openFile(path)} />,
    });
  }
  const claudeCodeLabel = `Claude Code'u projeyle aç (${describeChoice('claude-cli', ai.settings.models['claude-cli'], ai.settings.efforts['claude-cli']) || 'varsayılan model'})`;
  const claudeSession =
    terminal?.kind === 'claude-code'
      ? {
          summary: describeChoice('claude-cli', terminal.options?.model ?? '', terminal.options?.effort ?? '') || 'varsayılan model',
          bypass: terminal.options?.skipPermissions === true,
          stale:
            (terminal.options?.model ?? '') !== ai.settings.models['claude-cli'] ||
            (terminal.options?.effort ?? '') !== ai.settings.efforts['claude-cli'] ||
            (terminal.options?.skipPermissions === true) !== ai.settings.skipPermissions,
          // The remote site (and its password) is not kept for a restart: the form has to be filled again.
          restart: () => openClaudeCode(),
        }
      : undefined;
  function openClaudeCode(remote?: RemoteSite, extraContext?: string) {
    const start = () =>
      openTerminal('claude-code', { model: ai.settings.models['claude-cli'], effort: ai.settings.efforts['claude-cli'], skipPermissions: ai.settings.skipPermissions, remote, extraContext });
    if (!state.workspace) {
      start();
      return;
    }
    // The bundled skills (ios-app-xtool, mobile-ios-design, find-skills) go into .claude/skills first so
    // Claude Code discovers them at start; a failure is shown but never blocks the session.
    void ipc
      .skillsInstallBundled()
      .then((r) => {
        if (r.installed.length > 0) setRefreshKey((k) => k + 1);
      })
      .catch((e: unknown) => setNotice(`Hazır skill'ler projeye kopyalanamadı: ${String(e)}`))
      .finally(start);
  }
  if (terminal) {
    bottomTabs.push({
      id: 'terminal',
      label: TERMINAL_TITLES[terminal.kind],
      content: (
        <TerminalPanel
          kind={terminal.kind}
          options={terminal.options}
          onStartClaudeCode={terminal.kind === 'user-shell' ? { label: claudeCodeLabel, run: () => openClaudeCode() } : undefined}
          session={terminal.kind === 'claude-code' ? claudeSession : undefined}
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
  if (deviceLogOpen && deviceRun.op !== null) {
    bottomTabs.push({
      id: 'devicelog',
      label: 'Cihaz günlükleri',
      badge: deviceRun.running ? 'çalışıyor' : undefined,
      tone: deviceRun.running ? 'busy' : undefined,
      content: (
        <LogView
          state={deviceRun}
          emptyText="Henüz cihaz işlemi yok."
          onClear={() => deviceDispatch({ type: 'clear' })}
          onCancel={() => void ipc.xtoolCancel()}
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

  const viewContent =
    state.activeView === 'preflight' ? (
      <PreflightView
              report={preflight}
              running={preflightRunning}
              progress={preflightProgress}
              error={preflightError}
              gateReason={gate.reason}
              onRun={() => void runPreflightNow()}
              onHandOff={() => openClaudeCode(undefined, `Yayın öncesi denetim raporu ${REPORT_MD} dosyasında; önce onu oku, kırmızı adımları düzelt, sonra kullanıcıdan denetimi yeniden çalıştırmasını iste.`)}
              onClose={() => dispatch({ type: 'closeView', id: 'preflight' })}
            />
    ) : state.activeView !== null ? (
      <PolicyPanel
              which={state.activeView === 'appstore' ? 'asr' : 'msec'}
              report={report}
              loading={analysing}
              error={analysisError}
              onRun={() => void runAnalysis()}
              onClose={() => dispatch({ type: 'closeView', id: state.activeView === 'appstore' ? 'appstore' : 'security' })}
            />
    ) : null;

  return (
    <ThemeContext.Provider value={themeDef}>
    <div className="app" ref={appRef} style={layoutVars}>
      {!desktop && (
        <div className="banner" role="alert">
          Tarayıcıda çalışıyor: dosya erişimi yok. Masaüstü uygulamasını kullanın.
        </div>
      )}
      <div className="body">
        <ActivityBar
          view={view}
          desktop={desktop}
          terminalOpen={terminal !== null && bottomVisible && activeBottom === 'terminal'}
          policyView={state.activeView === 'appstore' ? 'asr' : state.activeView === 'security' ? 'msec' : null}
          onView={(v) => {
            if (v === 'build') openBuild();
            else if (v === 'devices') openDevices();
            else if (v === 'ai') {
              setView('ai');
              setChatOpen(true);
            } else setView('files');
          }}
          onTerminal={() => openTerminal('user-shell')}
          onStore={() => dispatch({ type: 'openView', id: 'appstore' })}
          onSecurity={() => dispatch({ type: 'openView', id: 'security' })}
          onSettings={() => setShowSettings(true)}
        />

        <aside className="sidebar" aria-label={SIDEBAR_TITLES[view]}>
          {view !== 'files' && <div className="side-title">{SIDEBAR_TITLES[view]}</div>}
          {view === 'files' && (
            <>
            <div className="files-head">
              <div className="files-title">
                <span>{SIDEBAR_TITLES.files}</span>
                <span className="files-tools">
                  <button type="button" className="icon-btn" onClick={() => setRefreshKey((k) => k + 1)} disabled={!hasWorkspace} aria-label="Dosya listesini yenile" title="Dosya listesini yenile">
                    <IconRefresh />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setCollapseKey((k) => k + 1)} disabled={!hasWorkspace} aria-label="Tüm klasörleri daralt" title="Tüm klasörleri daralt">
                    <IconCollapse />
                  </button>
                </span>
              </div>
              {state.workspace ? (
                <div className="files-project" title={state.workspace}>
                  <span className="files-project-caption">Açık proje klasörü</span>
                  <strong>{state.workspace.split('/').pop()}</strong>
                  <span className="files-project-path">{state.workspace}</span>
                </div>
              ) : (
                <p className="files-empty">Henüz bir proje klasörü açık değil.</p>
              )}
              <span className="files-actions">
                <button type="button" className={state.workspace ? '' : 'primary'} onClick={() => void openFolder()} disabled={!desktop}>
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
                  placeholder="Sources/Uygulama/Ekran.swift (proje klasörüne göre yol)"
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
                activePath={binary ? binary.path : state.active}
                revealArtifacts={revealArtifacts}
                collapseKey={collapseKey}
                onOpen={(p) => void openFile(p)}
                onError={fail}
              />
            ) : (
              <p className="muted pad">Başlamak için bir klasör açın.</p>
            )}
            </>
          )}
          {view === 'build' && (
            <BuildSidebar
              info={xtoolInfo}
              infoLoading={xtoolLoading}
              compatibility={compatibility(parsedVersion)}
              versionLabel={parsedVersion.value ?? (xtoolInfo?.versionOutput ?? null)}
              swiftLabel={parseSwiftVersion(xtoolInfo?.swiftVersionOutput ?? '')}
              hasWorkspace={hasWorkspace}
              build={build}
              deviceRun={deviceRun}
              diagnostics={diagnostics}
              deviceName={selectedDevice?.name ?? null}
              installBlocked={installCheck.reason}
              preflight={{ verdict: preflight?.verdict ?? null, running: preflightRunning, gateReason: gate.reason, finishedAt: preflight?.finishedAt ?? null }}
              onPreflight={() => void runPreflightNow()}
              onOpenPreflight={() => dispatch({ type: 'openView', id: 'preflight' })}
              doctor={doctor}
              doctorLoading={doctorLoading}
              doctorError={doctorError}
              onDoctor={() => void runDoctor()}
              onRedetect={() => void detectXtool()}
              onRun={(op, args) => void runXtool(op, args)}
              onInstall={(configuration) => void runXtool('run-device', { configuration, udid: selectedUdid ?? undefined })}
              onCancel={() => void ipc.xtoolCancel()}
              onClear={() => {
                buildDispatch({ type: 'clear' });
                deviceDispatch({ type: 'clear' });
              }}
              onShowOutput={showOutput}
              onShowDevices={openDevices}
            />
          )}
          {view === 'devices' && (
            <DevicesPanel
              xtoolFound={xtoolInfo?.found === true}
              devices={devices}
              authText={authText}
              authLoggedIn={authLoggedIn}
              loading={devicesLoading}
              error={devicesError}
              hasWorkspace={hasWorkspace}
              running={anyRunning}
              selectedUdid={selectedUdid}
              preflight={gate}
              onSelect={setSelectedUdid}
              onRefresh={() => void refreshDevices()}
              onRunOnDevice={(udid, configuration) => void runXtool('run-device', { configuration, udid: udid ?? undefined })}
              onLaunch={(udid, bundleId) => void runXtool('launch', { bundleId, udid: udid ?? undefined })}
            />
          )}
          {view === 'ai' && (
            <AiSettingsPanel
              settings={ai.settings}
              keyStored={ai.keyStored}
              keyringError={ai.keyringError}
              models={ai.models}
              modelsLoading={ai.modelsLoading}
              modelsError={ai.modelsError}
              cliProvider={ai.cliProvider}
              cliStatus={ai.cliStatus}
              cliError={ai.cliError}
              chatOpen={chatOpen}
              onSettings={ai.setSettings}
              onSetKey={ai.setKey}
              onDeleteKey={ai.deleteKey}
              onRefreshModels={ai.refreshModels}
              onRefreshCli={ai.refreshCli}
              onLoginEmbedded={() => ai.cliProvider && openTerminal(CLI_TERMINAL_KIND[ai.cliProvider])}
              onLoginSystem={ai.openSystemLogin}
              onOpenClaudeCode={openClaudeCode}
              onOpenChat={() => setChatOpen(true)}
            />
          )}
        </aside>
        <Splitter
          orientation="vertical"
          direction={1}
          label="Kenar paneli genişliği"
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
          {binary ? (
            <BinaryCard
              path={binary.path}
              kind={binary.kind}
              error={binary.error}
              onRevealSelf={() => void ipc.revealPath(binary.path, false).catch((e: unknown) => setBinary({ ...binary, error: String(e) }))}
              onRevealParent={() => void ipc.revealPath(binary.path, true).catch((e: unknown) => setBinary({ ...binary, error: String(e) }))}
              onShowArtifacts={() => setRevealArtifacts((n) => n + 1)}
              onClose={() => setBinary(null)}
            />
          ) : state.tabs.length === 0 && state.views.length === 0 ? (
            <WelcomeScreen
              desktop={desktop}
              workspace={state.workspace}
              xtoolFound={xtoolInfo ? xtoolInfo.found : null}
              aiProviderLabel={PROVIDER_LABELS[ai.settings.provider] ?? ai.settings.provider}
              aiReady={ai.cliProvider ? (ai.cliStatus ? ai.cliStatus.loggedIn : null) : ai.needsKey ? ai.keyStored : true}
              onOpenFolder={() => void openFolder()}
              onNewFile={() => setNewName('')}
              onOpenAi={() => {
                setView('ai');
                setChatOpen(true);
              }}
              onOpenBuild={openBuild}
              onOpenAppStore={() => dispatch({ type: 'openView', id: 'appstore' })}
            />
          ) : (
          <EditorPane
            tabs={state.tabs}
            active={state.active}
            views={state.views.map((id) => ({ id, title: VIEW_TITLE[id] }))}
            activeView={state.activeView}
            viewContent={viewContent}
            onActivateView={(id: ViewId) => dispatch({ type: 'activateView', id })}
            onCloseView={(id: ViewId) => dispatch({ type: 'closeView', id })}
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
                    } else if (id === 'devicelog') setDeviceLogOpen(false);
                    else setBuildOpen(false);
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
          <div className="ai-dock">
            <ChatPanel
              state={ai.chat}
              settings={ai.settings}
              keyStored={ai.keyStored}
              cliStatus={ai.cliStatus}
              contextSummary={ai.contextSummary}
              hasWorkspace={hasWorkspace}
              theme={theme}
              onSend={ai.send}
              onStop={ai.stop}
              onDecide={ai.decide}
              onDecideAll={ai.decideAll}
              onApply={ai.apply}
              applying={ai.applying}
              applyBlockedReason={ai.applyBlockedReason}
              onSettings={ai.setSettings}
              onOpenClaudeCode={() => openClaudeCode()}
              onOpenSettings={() => setView('ai')}
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>
      <StatusBar
        workspace={state.workspace}
        xtool={{ found: xtoolInfo ? xtoolInfo.found : null, version: parsedVersion.value }}
        swift={parseSwiftVersion(xtoolInfo?.swiftVersionOutput ?? '')}
        device={selectedDevice?.name ?? null}
        ai={{ label: PROVIDER_LABELS[ai.settings.provider], state: session.label, tone: session.tone }}
        errors={errorCount}
        warnings={warningCount}
        panelAvailable={bottomTabs.length > 0}
        panelVisible={bottomVisible}
        onXtool={openBuild}
        onDevice={openDevices}
        onAi={() => setView('ai')}
        onProblems={() => {
          setBuildOpen(true);
          showBottom('problems');
        }}
        onTogglePanel={() => toggleBottomRef.current()}
      />
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
      {showSettings && <SettingsDialog settings={settings} desktop={desktop} onChange={setSettings} onClose={() => setShowSettings(false)} />}
      {showPalette && <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />}
    </div>
    </ThemeContext.Provider>
  );
}

function PolicyPanel({ which, ...props }: { which: 'asr' | 'msec' } & React.ComponentProps<typeof SecurityCenter>) {
  return which === 'asr' ? <AppStoreReadiness {...props} /> : <SecurityCenter {...props} />;
}
