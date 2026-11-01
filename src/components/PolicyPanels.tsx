import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EvaluationReport, RuleResult } from '../policy/types';
import {
  SECURITY_GROUPS,
  SEVERITY_LABEL,
  STATUS_LABEL,
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
      <span className={`pp-badge pp-status-${r.status}`}>{STATUS_LABEL[r.status]} <small>{r.status.toLowerCase()}</small></span>
      <span className="pp-badge pp-impl" title="Uygulama durumu">{r.implementation}</span>
      <span className="pp-badge pp-sev">{SEVERITY_LABEL[r.severity]}</span>
      {expandable && <span className="pp-muted">{findings.length} bulgu</span>}
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
      {needsReason && <div className="pp-reason">Neden: {r.reason ?? 'Neden kaydedilmedi.'}</div>}
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
              {f.remediation && <p className="pp-remed"><strong>Çözüm önerisi:</strong> {f.remediation}</p>}
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
              {loading ? 'Analiz ediliyor…' : report ? 'Analizi yeniden çalıştır' : 'Analizi çalıştır'}
            </button>
            <button type="button" ref={closeRef} onClick={onClose}>Kapat</button>
          </span>
        </header>
        <div className="pp-body">
          <p className="pp-muted pp-note">Kural metinleri teknik kaynaklara bağlı olduğundan İngilizce gösterilir.</p>
          {error && <div className="pp-error" role="alert">Analiz başarısız oldu: {error}</div>}
          {!report && !error && (
            <div className="pp-state">
              <h3>Henüz analiz yok</h3>
              <p>
                Bu görünüm, proje dosyalarınıza karşı denetlenen politika kurallarını listeler. Analizi çalıştırana kadar
                hiçbir şey değerlendirilmez; kaynaktan karara bağlanamayan kurallar doğrulanamadı olarak işaretli kalır.
              </p>
              <button type="button" onClick={onRun} disabled={loading}>{loading ? 'Analiz ediliyor…' : 'Analizi çalıştır'}</button>
            </div>
          )}
          {report && children(report)}
        </div>
        <footer className="pp-foot">
          <p>Reddedilme riskini azaltır; App Store onayı garanti edilmez. App Review sonucuna yalnızca Apple karar verir.</p>
          <p>Skor yok, kaynak düzeyinde kontroller: derlemenin başarılı olması App Store uyumluluğu anlamına gelmez.</p>
        </footer>
      </div>
    </div>
  );
}

function Header({ report }: { report: EvaluationReport }) {
  return (
    <section aria-label="Özet">
      {report.blocksRelease && (
        <div className="pp-blocked" role="alert">Sürüm engellendi: en az bir kritik kural başarısız oldu.</div>
      )}
      <ul className="pp-counts" aria-label="Duruma göre kural sayıları">
        {STATUS_ORDER.map((s) => (
          <li key={s}>{STATUS_LABEL[s]}: {report.counts[s]}</li>
        ))}
      </ul>
      <p className="pp-unverified">{unverifiedLine(report.counts)}</p>
      <p className="pp-meta">Oluşturulma: {report.generatedAt}</p>
    </section>
  );
}

export function AppStoreReadiness(props: PolicyPanelProps) {
  return (
    <Shell title="App Store Hazırlığı" titleId="pp-title-asr" props={props}>
      {(full) => {
        const report = filterByPrefix(full, 'ASR-');
        if (report.results.length === 0) return <p className="pp-muted">Bu raporda App Store kuralı yok.</p>;
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
  if (report.results.length === 0) return <p className="pp-muted">Bu raporda güvenlik kuralı yok.</p>;
  const visible = cat ? report.results.filter((r) => securityGroup(r) === cat) : report.results;
  return (
    <>
      <Header report={report} />
      <div className="pp-chips" role="group" aria-label="Kategoriye göre filtrele">
        <button type="button" className="pp-chip" aria-pressed={cat === null} onClick={() => setCat(null)}>
          Tümü ({report.results.length})
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
        <section className="pp-group" key={g.severity} aria-label={`${SEVERITY_LABEL[g.severity]} önem`}>
          <h3>{SEVERITY_LABEL[g.severity]} ({g.results.length})</h3>
          <ul className="pp-rules">
            {sortResults(g.results).map((r) => (
              <RuleRow key={r.ruleId} r={r} />
            ))}
          </ul>
        </section>
      ))}
      {unverifiedCount(report.counts) > 0 && (
        <p className="pp-muted">Doğrulanamayan kurallar geçmiş sayılmaz: hâlâ incelenmeleri gerekir.</p>
      )}
    </>
  );
}

export function SecurityCenter(props: PolicyPanelProps) {
  return (
    <Shell title="Güvenlik Merkezi" titleId="pp-title-msec" props={props}>
      {(full) => <SecurityBody full={full} />}
    </Shell>
  );
}
