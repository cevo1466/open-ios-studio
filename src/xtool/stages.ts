import type { XtoolOp } from './types';

/**
 * Progress stages derived from the log text. xtool prints no machine-readable progress, so a stage
 * counts as reached once a line matches its keywords. The UI labels this as an estimate.
 */
export type StageId = 'package' | 'sign' | 'install' | 'verify';
export type StageState = 'pending' | 'active' | 'done' | 'failed';

interface StageDef {
  id: StageId;
  label: string;
  match: RegExp;
}

const ALL: StageDef[] = [
  { id: 'package', label: 'Paketleme', match: /packag|bundl|compil|linking|building|build complete/i },
  { id: 'sign', label: 'İmzalama', match: /sign|provision|certificate|entitlement/i },
  { id: 'install', label: 'Yükleme', match: /install|upload|transfer|copying/i },
  { id: 'verify', label: 'Doğrulama', match: /verif|launch|started|ready/i },
];

export interface StageView {
  id: StageId;
  label: string;
  state: StageState;
}

export interface RunResult {
  code: number | null;
  cancelled: boolean;
}

/** Which stages apply to an operation. Other operations show no stage bar. */
export function stagesFor(op: XtoolOp | null): StageDef[] {
  if (op === 'run-device') return ALL;
  if (op === 'build') return ALL.slice(0, 1);
  return [];
}

export function stageProgress(op: XtoolOp | null, lines: string[], running: boolean, result: RunResult | null): StageView[] {
  const defs = stagesFor(op);
  if (defs.length === 0) return [];
  let reached = -1;
  defs.forEach((d, i) => {
    if (lines.some((l) => d.match.test(l))) reached = i;
  });
  const ok = result !== null && result.code === 0 && !result.cancelled;
  const finished = !running && result !== null;
  return defs.map((d, i) => {
    let state: StageState = 'pending';
    if (ok) state = 'done';
    else if (i < reached) state = 'done';
    else if (i === reached) state = finished ? 'failed' : 'active';
    else if (finished && reached === -1 && i === 0) state = 'failed';
    return { id: d.id, label: d.label, state };
  });
}
