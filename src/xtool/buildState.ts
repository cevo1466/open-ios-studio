import type { RunEvent, XtoolOp } from './types';

export const MAX_LOG_LINES = 5000;

export interface LogLine {
  id: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface BuildOutcome {
  code: number | null;
  cancelled: boolean;
  timedOut: boolean;
  droppedLines: number;
}

export interface BuildState {
  lines: LogLine[];
  dropped: number;
  running: boolean;
  op: XtoolOp | null;
  outcome: BuildOutcome | null;
  /** Next line id; strictly increasing, never reset except by `clear`/`start`. */
  nextId: number;
}

export type BuildAction =
  | { type: 'start'; op: XtoolOp }
  | { type: 'event'; event: RunEvent }
  | { type: 'clear' };

export const initialBuildState: BuildState = {
  lines: [],
  dropped: 0,
  running: false,
  op: null,
  outcome: null,
  nextId: 1,
};

export function buildReducer(state: BuildState, action: BuildAction): BuildState {
  switch (action.type) {
    case 'start':
      return { ...initialBuildState, running: true, op: action.op };
    case 'clear':
      return { ...initialBuildState, running: state.running, op: state.op };
    case 'event': {
      const ev = action.event;
      if (ev.kind === 'line') {
        const lines = [...state.lines, { id: state.nextId, stream: ev.stream, text: ev.text }];
        let dropped = state.dropped;
        if (lines.length > MAX_LOG_LINES) {
          const over = lines.length - MAX_LOG_LINES;
          lines.splice(0, over);
          dropped += over;
        }
        return { ...state, lines, dropped, nextId: state.nextId + 1 };
      }
      return {
        ...state,
        running: false,
        dropped: state.dropped + ev.droppedLines,
        outcome: {
          code: ev.code,
          cancelled: ev.cancelled,
          timedOut: ev.timedOut,
          droppedLines: ev.droppedLines,
        },
      };
    }
  }
}
