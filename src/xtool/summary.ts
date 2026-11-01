import type { BuildState } from './buildState';
import type { Diagnostic } from './types';

export type SummaryTone = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

export interface RunSummary {
  tone: SummaryTone;
  title: string;
  /** One short sentence for failures; the full log stays one click away. */
  detail: string | null;
}

const MAX_DETAIL = 160;
const short = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s);

const OP_NAME: Record<string, string> = {
  build: 'Derleme',
  'run-device': 'Derleme ve yükleme',
  launch: 'Uygulamayı başlatma',
  new: 'Proje oluşturma',
  'sdk-status': 'SDK denetimi',
};

export function summarize(state: BuildState, diagnostics: Diagnostic[]): RunSummary {
  const name = (state.op && OP_NAME[state.op]) || 'İşlem';
  if (state.running) return { tone: 'running', title: `${name} sürüyor`, detail: null };
  const o = state.outcome;
  if (!o) return { tone: 'idle', title: 'Henüz işlem yok', detail: null };
  if (o.cancelled) return { tone: 'cancelled', title: `${name} iptal edildi`, detail: null };
  if (o.timedOut) return { tone: 'error', title: `${name} zaman aşımına uğradı`, detail: 'İşlem beklenenden uzun sürdü ve durduruldu.' };
  if (o.code === 0) return { tone: 'success', title: `${name} başarılı`, detail: null };
  const firstError = diagnostics.find((d) => d.severity === 'error');
  const lastStderr = [...state.lines].reverse().find((l) => l.stream === 'stderr' && l.text.trim() !== '');
  const detail = firstError?.message ?? lastStderr?.text.trim() ?? 'Ayrıntılar günlükte.';
  return { tone: 'error', title: `${name} başarısız oldu`, detail: short(detail) };
}
