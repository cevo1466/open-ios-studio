import type { SessionTone } from '../ai/readiness';

type Tone = 'ok' | 'warn' | 'off' | 'unknown';

export interface StatusBarProps {
  workspace: string | null;
  xtool: { found: boolean | null; version: string | null };
  swift: string | null;
  device: string | null;
  ai: { label: string; state: string; tone: SessionTone };
  errors: number;
  warnings: number;
  panelAvailable: boolean;
  panelVisible: boolean;
  onXtool(): void;
  onDevice(): void;
  onAi(): void;
  onProblems(): void;
  onTogglePanel(): void;
}

function Seg({ tone, children, title, onClick }: { tone?: Tone; children: React.ReactNode; title?: string; onClick?: () => void }) {
  const inner = (
    <>
      {tone && <span className={`sb-dot sb-${tone}`} aria-hidden="true" />}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className="sb-seg" title={title} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <span className="sb-seg" title={title}>
      {inner}
    </span>
  );
}

export function StatusBar(p: StatusBarProps) {
  const xtoolTone: Tone = p.xtool.found === null ? 'unknown' : p.xtool.found ? 'ok' : 'warn';
  const aiTone: Tone = p.ai.tone === 'ok' ? 'ok' : p.ai.tone === 'warn' ? 'warn' : 'unknown';
  return (
    <footer className="status" aria-label="Durum çubuğu">
      <div className="sb-group">
        <Seg title={p.workspace ?? 'Klasör açık değil'}>{p.workspace ? (p.workspace.split('/').filter(Boolean).pop() ?? p.workspace) : 'Klasör açık değil'}</Seg>
        <Seg tone={xtoolTone} onClick={p.onXtool} title="Derle bölümünü aç">
          xtool {p.xtool.found === null ? 'denetlenmedi' : p.xtool.found ? (p.xtool.version ?? 'bulundu') : 'yok'}
        </Seg>
        <Seg tone={p.swift ? 'ok' : p.xtool.found === null ? 'unknown' : 'warn'} title="Swift araç zinciri">
          Swift {p.swift ?? 'yok'}
        </Seg>
        <Seg tone={p.device ? 'ok' : 'off'} onClick={p.onDevice} title="Cihazlar bölümünü aç">
          {p.device ?? 'iPhone bağlı değil'}
        </Seg>
      </div>
      <div className="sb-group">
        <Seg tone={aiTone} onClick={p.onAi} title="Yapay zekâ ayarlarını aç">
          {p.ai.label} · {p.ai.state}
        </Seg>
        <Seg onClick={p.onProblems} title="Sorunları göster">
          <span className={p.errors > 0 ? 'sb-err' : undefined}>{p.errors} hata</span>
          <span className={p.warnings > 0 ? 'sb-warn' : undefined}>{p.warnings} uyarı</span>
        </Seg>
        {p.panelAvailable && (
          <button type="button" className="sb-seg" aria-pressed={p.panelVisible} onClick={p.onTogglePanel} title="Alt paneli göster/gizle (Ctrl+J)">
            {p.panelVisible ? 'Paneli gizle' : 'Paneli göster'}
          </button>
        )}
      </div>
    </footer>
  );
}
