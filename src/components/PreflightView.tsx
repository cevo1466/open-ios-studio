import { useEffect, useRef, useState } from 'react';
import { HONESTY_LINE, REPORT_MD, STEP_NAME, STEP_ORDER, STEP_STATUS_LABEL, type PreflightReport, type StepId, type StepResult, type StepStatus } from '../preflight';
import '../policy-panels.css';
import '../preflight-view.css';

export type StepProgress = Partial<Record<StepId, 'running' | StepResult>>;

export interface PreflightViewProps {
  report: PreflightReport | null;
  running: boolean;
  progress: StepProgress;
  error: string | null;
  /** Why the install gate is closed right now, or null when open. */
  gateReason: string | null;
  onRun: () => void;
  onHandOff: () => void;
  onClose: () => void;
}

function badgeClass(status: StepStatus): string {
  return `pp-badge pp-status-${status === 'WARNING' ? 'WARNING' : status}`;
}

function StepRow({ id, state }: { id: StepId; state: 'running' | StepResult | undefined }) {
  const [open, setOpen] = useState(false);
  const name = STEP_NAME[id];
  if (state === undefined) {
    return (
      <li className="pf-step pf-pending">
        <span className="pf-name">{name}</span>
        <span className="pp-muted">bekliyor</span>
      </li>
    );
  }
  if (state === 'running') {
    return (
      <li className="pf-step pf-running" aria-busy="true">
        <span className="pf-name">{name}</span>
        <span className="pp-muted">çalışıyor…</span>
      </li>
    );
  }
  const expandable = state.details.length > 0;
  return (
    <li className={`pf-step pf-${state.status}`}>
      <div className="pf-step-head">
        <span className={badgeClass(state.status)}>{STEP_STATUS_LABEL[state.status]}</span>
        <span className="pf-name">{name}</span>
        <span className="pf-summary">{state.summary}</span>
        {expandable && (
          <button type="button" className="tree-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Ayrıntıları gizle' : `${state.details.length} ayrıntı`}
          </button>
        )}
      </div>
      {expandable && open && (
        <ul className="pf-details">
          {state.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * "Yayın öncesi denetim": six steps, one verdict, the install gate's reason, and the hand-off to
 * Claude Code. Renders inside the editor region like the policy panels.
 */
export function PreflightView(p: PreflightViewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const steps: StepProgress = p.running ? p.progress : Object.fromEntries((p.report?.steps ?? []).map((s) => [s.id, s]));
  const verdict = p.report && !p.running ? p.report.verdict : null;
  return (
    <section
      className="pp-view pf-view"
      role="region"
      aria-labelledby="pf-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') p.onClose();
      }}
    >
      <header className="pp-head">
        <h2 id="pf-title">Yayın öncesi denetim</h2>
        <span className="pp-actions">
          <button type="button" onClick={p.onRun} disabled={p.running}>
            {p.running ? 'Denetleniyor…' : p.report ? 'Yeniden çalıştır' : 'Denetimi çalıştır'}
          </button>
          <button type="button" ref={closeRef} onClick={p.onClose} title="Görünümü kapat (Esc)">
            Kapat
          </button>
        </span>
      </header>
      <div className="pp-body">
        <div className="pp-content">
          {p.error && (
            <div className="pp-error" role="alert">
              Denetim çalıştırılamadı: {p.error}
            </div>
          )}
          {verdict === 'red' && (
            <div className="pp-blocked" role="status">
              Sonuç kırmızı: {p.gateReason ?? 'en az bir adım başarısız.'} Yeşil olana kadar "Derle ve Yükle" ve yayın adımları kilitli.
            </div>
          )}
          {verdict === 'green' && (
            <div className={p.gateReason ? 'pp-unverified' : 'pf-green'} role="status">
              {p.gateReason ? `Sonuç yeşildi ama ${p.gateReason.charAt(0).toLowerCase()}${p.gateReason.slice(1)}.` : 'Sonuç yeşil: "Derle ve Yükle" açık.'}
            </div>
          )}
          {!p.report && !p.running && !p.error && (
            <div className="pp-state">
              <h3>Henüz denetim yok</h3>
              <p>
                Denetim sırayla derler, varsa <code>swift test</code> çalıştırır, politika ve gizli anahtar kurallarını uygular, manifest ve simgeyi kontrol eder.
                Kırmızı olduğu sürece "Derle ve Yükle" ve yayın adımları kapalıdır.
              </p>
              <button type="button" onClick={p.onRun}>
                Denetimi çalıştır
              </button>
            </div>
          )}
          {(p.running || p.report) && (
            <ol className="pf-steps" aria-label="Adımlar">
              {STEP_ORDER.map((id) => (
                <StepRow key={id} id={id} state={steps[id]} />
              ))}
            </ol>
          )}
          {p.report && !p.running && (
            <div className="pf-foot-actions">
              <button type="button" className={verdict === 'red' ? 'primary' : ''} onClick={p.onHandOff}>
                Raporu Claude Code'a ver
              </button>
              <span className="pp-muted">
                Rapor: <code>{REPORT_MD}</code> · {p.report.finishedAt}
              </span>
            </div>
          )}
        </div>
      </div>
      <footer className="pp-foot">
        <p>{HONESTY_LINE}</p>
      </footer>
    </section>
  );
}
