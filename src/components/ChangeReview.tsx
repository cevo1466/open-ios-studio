import { DiffEditor } from '@monaco-editor/react';
import type { PendingChange } from '../ai/chatState';
import '../ai-panel.css';

export interface ChangeReviewProps {
  changes: PendingChange[];
  theme: 'light' | 'dark';
  onDecide(path: string, d: 'approved' | 'rejected'): void;
  onDecideAll(d: 'approved' | 'rejected'): void;
  onApply(): void;
  applying: boolean;
  blockedReason?: string | null;
}

const DECISION_TR: Record<PendingChange['decision'], string> = { pending: 'beklemede', approved: 'onaylandı', rejected: 'reddedildi' };

export function ChangeReview({ changes, theme, onDecide, onDecideAll, onApply, applying, blockedReason }: ChangeReviewProps) {
  const approved = changes.filter((c) => c.decision === 'approved').length;
  const disabled = approved === 0 || applying || !!blockedReason;
  return (
    <section className="ai-review" aria-label="Önerilen değişiklikler">
      <div className="ai-review-head">
        <h3>Önerilen değişiklikler ({changes.length})</h3>
        <div className="ai-row">
          <button type="button" onClick={() => onDecideAll('approved')}>
            Tümünü onayla
          </button>
          <button type="button" onClick={() => onDecideAll('rejected')}>
            Tümünü reddet
          </button>
        </div>
      </div>
      <p className="ai-note">Uygulayana kadar diske hiçbir şey yazılmaz. Her dosyayı inceleyip onaylayın veya reddedin.</p>
      <ul className="ai-changes">
        {changes.map((c) => (
          <li key={c.path} className={`ai-change ai-decision-${c.decision}`}>
            <div className="ai-change-head">
              <code className="ai-path">{c.path}</code>
              {c.original === null && <span className="ai-badge ai-badge-new">Yeni dosya</span>}
              <span className="ai-badge">{DECISION_TR[c.decision]}</span>
              <span className="ai-spacer" />
              <button type="button" aria-pressed={c.decision === 'approved'} onClick={() => onDecide(c.path, 'approved')}>
                Onayla
              </button>
              <button type="button" aria-pressed={c.decision === 'rejected'} onClick={() => onDecide(c.path, 'rejected')}>
                Reddet
              </button>
            </div>
            {c.findings.length > 0 && (
              <ul className="ai-findings" aria-label={`${c.path} için politika bulguları`}>
                {c.findings.map((f, i) => (
                  <li key={i} className={f.severity === 'critical' ? 'ai-finding ai-finding-critical' : 'ai-finding'}>
                    <span className="ai-badge">{f.ruleId}</span>
                    <span className="ai-badge ai-badge-sev">Önem: {f.severity}</span>
                    <span className="ai-badge">{f.status}</span>
                    <span>
                      {f.message}
                      {f.line !== undefined ? ` (satır ${f.line})` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="ai-diff">
              <DiffEditor
                height="260px"
                original={c.original ?? ''}
                modified={c.content}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                options={{ readOnly: true, originalEditable: false, renderSideBySide: false, minimap: { enabled: false }, scrollBeyondLastLine: false }}
              />
            </div>
          </li>
        ))}
      </ul>
      {blockedReason && (
        <p className="ai-error" role="alert">
          {blockedReason}
        </p>
      )}
      <div className="ai-row">
        <button type="button" className="ai-primary" disabled={disabled} onClick={onApply} title={blockedReason ?? (approved === 0 ? 'Önce en az bir değişikliği onaylayın' : undefined)}>
          {applying ? 'Uygulanıyor...' : `Onaylananları uygula (${approved})`}
        </button>
      </div>
    </section>
  );
}
