/**
 * Pre-submission check state for the app: the last report (reloaded from the workspace), the
 * running/progress/error state of the current run, the fingerprint of the files as they are now,
 * and the install gate derived from the two. App.tsx only renders what this returns.
 */
import { useCallback, useEffect, useState, type Dispatch } from 'react';
import type { StepProgress } from '../components/PreflightView';
import { ipc } from '../ipc';
import { analyzeProject } from '../policy';
import { loadCatalogs } from '../policy/catalog';
import { fingerprintFiles, gateInstall, iconHeaderString, readXtoolConfig, runPreflight, REPORT_JSON, type GateDecision, type PreflightReport } from '../preflight';
import type { Action } from '../state/store';
import { redactLine } from '../xtool/parse';

export interface PreflightOptions {
  workspace: string | null;
  dispatch: Dispatch<Action>;
  /** Called after a run wrote the report files (the explorer refreshes). */
  onReportWritten: () => void;
}

export interface PreflightHandle {
  report: PreflightReport | null;
  running: boolean;
  progress: StepProgress;
  error: string | null;
  currentFingerprint: string | null;
  gate: GateDecision;
  /** Recomputes the fingerprint of the files as they are now (after a save or a new project). */
  refreshFingerprint: () => Promise<void>;
  run: () => Promise<void>;
}

export function usePreflight({ workspace, dispatch, onReportWritten }: PreflightOptions): PreflightHandle {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<StepProgress>({});
  const [error, setError] = useState<string | null>(null);
  /** Fingerprint of the files as they are now; compared with the report's to detect staleness. */
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);

  const refreshFingerprint = useCallback(async () => {
    if (!workspace) {
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
  }, [workspace]);

  // A workspace change drops the old report, reloads the persisted one and fingerprints the files.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setReport(null);
      setProgress({});
      setError(null);
      setCurrentFingerprint(null);
      if (!workspace) return;
      try {
        const json = await ipc.readFileIfExists(REPORT_JSON);
        if (!cancelled && json) {
          const parsed = JSON.parse(json) as PreflightReport;
          if (parsed && parsed.version === 1 && Array.isArray(parsed.steps)) setReport(parsed);
        }
      } catch {
        /* an unreadable report simply counts as "not run" */
      }
      if (!cancelled) await refreshFingerprint();
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace, refreshFingerprint]);

  /** The pre-submission check: six steps, a verdict, and the report written into the workspace. */
  const run = useCallback(async () => {
    if (!workspace) {
      setError('Önce bir klasör açın.');
      dispatch({ type: 'openView', id: 'preflight' });
      return;
    }
    setRunning(true);
    setError(null);
    setProgress({});
    dispatch({ type: 'openView', id: 'preflight' });
    try {
      const result = await runPreflight(
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
        (id, st) => setProgress((prev) => ({ ...prev, [id]: st })),
      );
      setReport(result);
      setCurrentFingerprint(result.fingerprint);
      onReportWritten();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [workspace, dispatch, onReportWritten]);

  return { report, running, progress, error, currentFingerprint, gate: gateInstall(report, currentFingerprint), refreshFingerprint, run };
}
