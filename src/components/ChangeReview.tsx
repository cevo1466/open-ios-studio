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

export function ChangeReview({ changes, theme, onDecide, onDecideAll, onApply, applying, blockedReason }: ChangeReviewProps) {
  const approved = changes.filter((c) => c.decision === 'approved').length;
  const disabled = approved === 0 || applying || !!blockedReason;
  return (
    <section className="ai-review" aria-label="Proposed changes">
      <div className="ai-review-head">
        <h3>Proposed changes ({changes.length})</h3>
        <div className="ai-row">
          <button type="button" onClick={() => onDecideAll('approved')}>
            Approve all
          </button>
          <button type="button" onClick={() => onDecideAll('rejected')}>
            Reject all
          </button>
        </div>
      </div>
      <p className="ai-note">Nothing is written to disk until you apply.</p>
      <ul className="ai-changes">
        {changes.map((c) => (
          <li key={c.path} className={`ai-change ai-decision-${c.decision}`}>
            <div className="ai-change-head">
              <code className="ai-path">{c.path}</code>
              {c.original === null && <span className="ai-badge ai-badge-new">New file</span>}
              <span className="ai-badge">{c.decision}</span>
              <span className="ai-spacer" />
              <button type="button" aria-pressed={c.decision === 'approved'} onClick={() => onDecide(c.path, 'approved')}>
                Approve
              </button>
              <button type="button" aria-pressed={c.decision === 'rejected'} onClick={() => onDecide(c.path, 'rejected')}>
                Reject
              </button>
            </div>
            {c.findings.length > 0 && (
              <ul className="ai-findings" aria-label={`Policy findings for ${c.path}`}>
                {c.findings.map((f, i) => (
                  <li key={i} className={f.severity === 'critical' ? 'ai-finding ai-finding-critical' : 'ai-finding'}>
                    <span className="ai-badge">{f.ruleId}</span>
                    <span className="ai-badge ai-badge-sev">Severity: {f.severity}</span>
                    <span className="ai-badge">{f.status}</span>
                    <span>
                      {f.message}
                      {f.line !== undefined ? ` (line ${f.line})` : ''}
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
        <button type="button" className="ai-primary" disabled={disabled} onClick={onApply} title={blockedReason ?? (approved === 0 ? 'Approve at least one change first' : undefined)}>
          {applying ? 'Applying...' : `Apply approved changes (${approved})`}
        </button>
      </div>
    </section>
  );
}
