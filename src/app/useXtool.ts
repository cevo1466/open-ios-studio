/**
 * Everything about the xtool toolchain for the app: detection, the environment check, the build
 * and device-run logs, device/auth discovery and the single entry point that runs an allow-listed
 * operation. The install gate is consulted here so every caller (Derle panel, Devices panel,
 * palette) is refused the same way.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { ipc } from '../ipc';
import type { BottomTabId } from '../layout/BottomPanel';
import { buildReducer, initialBuildState, type BuildAction, type BuildState } from '../xtool/buildState';
import type { DoctorCheck } from '../xtool/doctor';
import { parseAuthStatus, parseDevices, parseDiagnostics, parseXtoolVersion, redactLine } from '../xtool/parse';
import type { Device, Diagnostic, RunEvent, XtoolInfo, XtoolOp, XtoolRunArgs } from '../xtool/types';

export interface XtoolOptions {
  workspace: string | null;
  desktop: boolean;
  showBottom: (id: BottomTabId) => void;
  setBuildOpen: (open: boolean) => void;
  setDeviceLogOpen: (open: boolean) => void;
  setNotice: (text: string | null) => void;
  /** After `xtool new` succeeded: refresh the explorer and the preflight fingerprint. */
  onNewProject: () => void;
}

export interface GateLike {
  allowed: boolean;
  reason: string | null;
}

export interface XtoolHandle {
  build: BuildState;
  buildDispatch: Dispatch<BuildAction>;
  deviceRun: BuildState;
  deviceDispatch: Dispatch<BuildAction>;
  xtoolInfo: XtoolInfo | null;
  xtoolLoading: boolean;
  detectXtool: () => Promise<void>;
  doctor: DoctorCheck[] | null;
  doctorLoading: boolean;
  doctorError: string | null;
  runDoctor: () => Promise<void>;
  devices: Device[] | null;
  authText: string | null;
  authLoggedIn: boolean | null;
  devicesLoading: boolean;
  devicesError: string | null;
  selectedUdid: string | null;
  setSelectedUdid: (udid: string | null) => void;
  /** The current install gate; App.tsx writes it every render, runXtool reads it. */
  gateRef: MutableRefObject<GateLike>;
  runXtool: (op: XtoolOp, args: XtoolRunArgs) => Promise<void>;
  collectXtool: (op: XtoolOp, args?: XtoolRunArgs) => Promise<{ text: string; code: number | null }>;
  refreshDevices: () => Promise<void>;
  diagnostics: Diagnostic[];
  parsedVersion: ReturnType<typeof parseXtoolVersion>;
}

export function useXtool({ workspace, desktop, showBottom, setBuildOpen, setDeviceLogOpen, setNotice, onNewProject }: XtoolOptions): XtoolHandle {
  const [build, buildDispatch] = useReducer(buildReducer, initialBuildState);
  /** Build + install + launch on a device keeps its own log, shown as "Cihaz günlükleri". */
  const [deviceRun, deviceDispatch] = useReducer(buildReducer, initialBuildState);
  const [xtoolInfo, setXtoolInfo] = useState<XtoolInfo | null>(null);
  const [xtoolLoading, setXtoolLoading] = useState(false);
  const [doctor, setDoctor] = useState<DoctorCheck[] | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [authText, setAuthText] = useState<string | null>(null);
  const [authLoggedIn, setAuthLoggedIn] = useState<boolean | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [selectedUdid, setSelectedUdid] = useState<string | null>(null);
  const gateRef = useRef<GateLike>({ allowed: false, reason: null });

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
        if (op === 'new') onNewProject();
      } catch (e) {
        onEvent({ kind: 'line', stream: 'stderr', text: String(e) });
        onEvent({ kind: 'exit', code: null, cancelled: false, timedOut: false, droppedLines: 0 });
      }
    },
    [showBottom, setBuildOpen, setDeviceLogOpen, setNotice, onNewProject],
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
    if (workspace === null) {
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
  }, [workspace, xtoolInfo, collectXtool]);

  useEffect(() => {
    if (!desktop) return;
    ipc
      .xtoolDetect()
      .then(setXtoolInfo)
      .catch(() => {
        /* the Build panel shows the detection error when opened */
      });
  }, [desktop]);

  const diagnostics = useMemo(() => parseDiagnostics(build.lines.map((l) => l.text)), [build.lines]);
  const parsedVersion = parseXtoolVersion(xtoolInfo?.versionOutput ?? '');

  return {
    build,
    buildDispatch,
    deviceRun,
    deviceDispatch,
    xtoolInfo,
    xtoolLoading,
    detectXtool,
    doctor,
    doctorLoading,
    doctorError,
    runDoctor,
    devices,
    authText,
    authLoggedIn,
    devicesLoading,
    devicesError,
    selectedUdid,
    setSelectedUdid,
    gateRef,
    runXtool,
    collectXtool,
    refreshDevices,
    diagnostics,
    parsedVersion,
  };
}
