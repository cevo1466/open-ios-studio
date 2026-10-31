import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EvaluationReport, RuleResult } from '../policy/types';
import {
  SECURITY_GROUPS,
  STATUS_ORDER,
  filterByPrefix,
  groupBySeverity,
  securityGroup,
  sortFindings,
  sortResults,
  unverifiedCount,
  unverifiedLine,
} from '../policy/view';
import '../policy-panels.css';

export interface PolicyPanelProps {
  report: EvaluationReport | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  onClose: () => void;
}

function RuleRow({ r }: { r: RuleResult }) {
  const [open, setOpen] = useState(false);
  const needsReason = r.status === 'NOT_APPLICABLE' || r.status === 'NOT_VERIFIED' || r.status === 'BLOCKED';
  const detailId = `pp-detail-${r.ruleId}`;
  const findings = sortFindings(r.findings);
  const expandable = findings.length > 0;
  const head = (
    <>
      <span className="pp-id">{r.ruleId}</span>
      <span className="pp-name">{r.name}</span>
      <span className={`pp-badge pp-status-${r.status}`}>{r.status.replace('_', ' ')}</span>
      <span className="pp-badge pp-impl" title="Implementation state">{r.implementation}</span>
      <span className="pp-badge pp-sev">{r.severity}</span>
      {expandable && <span className="pp-muted">{findings.length} finding{findings.length === 1 ? '' : 's'}</span>}
    </>
  );
  return (
    <li className="pp-rule">
      {expandable ? (
        <button type="button" className="pp-rule-head" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
          {head}
        </button>
      ) : (
        <div className="pp-rule-head">{head}</div>
      )}
      {needsReason && <div className="pp-reason">Reason: {r.reason ?? 'No reason recorded.'}</div>}
      {expandable && open && (
        <div className="pp-detail" id={detailId}>
          {findings.map((f, i) => (
            <div className="pp-finding" key={i}>
              {f.file && (
                <div className="pp-loc">
                  {f.file}
                  {f.line !== undefined ? `:${f.line}` : ''}
                </div>
              )}
              <div>{f.message}</div>
              {f.evidence && <pre>{f.evidence}</pre>}
              {f.remediation && <p className="pp-remed"><strong>Remediation:</strong> {f.remediation}</p>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function Shell({
  title,
  titleId,
  props,
  children,
}: {
  title: string;
  titleId: string;
  props: PolicyPanelProps;
  children: (r: EvaluationReport) => ReactNode;
}) {
  const { report, loading, error, onRun, onClose } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="pp-overlay" onMouseDown={onClose}>
      <div
        className="pp-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <header className="pp-head">
          <h2 id={titleId}>{title}</h2>
          <span className="pp-actions">
            <button type="button" onClick={onRun} disabled={loading}>
              {loading ? 'Analyzing…' : report ? 'Re-run analysis' : 'Run analysis'}
            </button>
            <button type="button" ref={closeRef} onClick={onClose}>Close</button>
          </span>
        </header>
        <div className="pp-body">
          {error && <div className="pp-error" role="alert">Analysis failed: {error}</div>}
          {!report && !error && (
            <div className="pp-state">
              <h3>No analysis yet</h3>
              <p>
                This view lists policy rules checked against your project files. Nothing has been evaluated until you run the
                analysis; rules that cannot be decided from source stay marked as unverified.
              </p>
              <button type="button" onClick={onRun} disabled={loading}>{loading ? 'Analyzing…' : 'Run analysis'}</button>
            </div>
          )}
          {report && children(report)}
        </div>
        <footer className="pp-foot">
          <p>Reduces rejection risk. Only Apple decides App Review outcomes.</p>
          <p>Build success is not App Store compliance.</p>
        </footer>
      </div>
    </div>
  );
}

function Header({ report }: { report: EvaluationReport }) {
  return (
    <section aria-label="Summary">
      {report.blocksRelease && (
        <div className="pp-blocked" role="alert">Release blocked: at least one critical rule failed.</div>
      )}
      <ul className="pp-counts" aria-label="Rule counts by status">
        {STATUS_ORDER.map((s) => (
          <li key={s}>{s.replace('_', ' ')}: {report.counts[s]}</li>
        ))}
      </ul>
      <p className="pp-unverified">{unverifiedLine(report.counts)}</p>
      <p className="pp-meta">Generated {report.generatedAt}</p>
    </section>
  );
}

export function AppStoreReadiness(props: PolicyPanelProps) {
  return (
    <Shell title="App Store Readiness" titleId="pp-title-asr" props={props}>
      {(full) => {
        const report = filterByPrefix(full, 'ASR-');
        if (report.results.length === 0) return <p className="pp-muted">No App Store rules in this report.</p>;
        return (
          <>
            <Header report={report} />
            <ul className="pp-rules">
              {sortResults(report.results).map((r) => <RuleRow key={r.ruleId} r={r} />)}
            </ul>
          </>
        );
      }}
    </Shell>
  );
}

function SecurityBody({ full }: { full: EvaluationReport }) {
  const [cat, setCat] = useState<string | null>(null);
  const report = filterByPrefix(full, 'MSEC-');
  if (report.results.length === 0) return <p className="pp-muted">No security rules in this report.</p>;
  const visible = cat ? report.results.filter((r) => securityGroup(r) === cat) : report.results;
  return (
    <>
      <Header report={report} />
      <div className="pp-chips" role="group" aria-label="Filter by category">
        <button type="button" className="pp-chip" aria-pressed={cat === null} onClick={() => setCat(null)}>
          All ({report.results.length})
        </button>
        {SECURITY_GROUPS.map((g) => {
          const n = report.results.filter((r) => securityGroup(r) === g).length;
          return n === 0 ? null : (
            <button key={g} type="button" className="pp-chip" aria-pressed={cat === g} onClick={() => setCat(cat === g ? null : g)}>
              {g} ({n})
            </button>
          );
        })}
      </div>
      {groupBySeverity(visible).map((g) => (
        <section className="pp-group" key={g.severity} aria-label={`${g.severity} severity`}>
          <h3>{g.severity} ({g.results.length})</h3>
          <ul className="pp-rules">
            {sortResults(g.results).map((r) => (
              <RuleRow key={r.ruleId} r={r} />
            ))}
          </ul>
        </section>
      ))}
      {unverifiedCount(report.counts) > 0 && (
        <p className="pp-muted">Unverified rules are not passes: they still need review.</p>
      )}
    </>
  );
}

export function SecurityCenter(props: PolicyPanelProps) {
  return (
    <Shell title="Security Center" titleId="pp-title-msec" props={props}>
      {(full) => <SecurityBody full={full} />}
    </Shell>
  );
}
