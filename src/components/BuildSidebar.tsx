import { useState } from 'react';
import type { BuildState } from '../xtool/buildState';
import { validateProjectName } from '../xtool/parse';
import { stageProgress } from '../xtool/stages';
import { summarize } from '../xtool/summary';
import type { Diagnostic, XtoolInfo, XtoolOp, XtoolRunArgs } from '../xtool/types';
import '../build-panel.css';

export interface BuildSidebarProps {
  info: XtoolInfo | null;
  infoLoading: boolean;
  compatibility: 'tested' | 'untested' | 'unknown';
  versionLabel: string | null;
  swiftLabel: string | null;
  hasWorkspace: boolean;
  /** Last build/sdk/new run. */
  build: BuildState;
  /** Last device run (build + install + launch). */
  deviceRun: BuildState;
  diagnostics: Diagnostic[];
  /** Name of the selected/only connected device, or null. */
  deviceName: string | null;
  /** Why "Derle ve Yükle" is not possible, or null when it is. */
  installBlocked: string | null;
  onRedetect(): void;
  onRun(op: XtoolOp, args: XtoolRunArgs): void;
  onInstall(configuration: 'debug' | 'release'): void;
  onCancel(): void;
  onClear(): void;
  onShowOutput(): void;
  onShowDevices(): void;
}

const STAGE_TITLE = 'Aşamalar günlük satırlarından tahmin edilir; xtool ilerleme bilgisi vermez.';

function Row({ label, tone, children }: { label: string; tone?: 'ok' | 'warn' | 'off'; children: React.ReactNode }) {
  return (
    <div className="bs-row">
      <dt>{label}</dt>
      <dd>
        {tone && <span className={`sb-dot sb-${tone}`} aria-hidden="true" />}
        {children}
      </dd>
    </div>
  );
}

/** Left "Derle" view: a compact summary, one primary action and the secondary ones. */
export function BuildSidebar(p: BuildSidebarProps) {
  const [configuration, setConfiguration] = useState<'debug' | 'release'>('debug');
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const found = p.info?.found === true;
  const running = p.build.running || p.deviceRun.running;
  const nameCheck = validateProjectName(name);
  const nameError = name.length > 0 && !nameCheck.ok ? nameCheck.reason : null;

  let blocked: string | null = null;
  if (running) blocked = 'Zaten çalışan bir işlem var. İptal edin veya bitmesini bekleyin.';
  else if (!found) blocked = 'xtool bulunamadı, bu yüzden bu işlem kullanılamıyor.';
  else if (!p.hasWorkspace) blocked = 'Önce bir çalışma klasörü açın.';

  // The most recent run decides what the summary and stage bar describe.
  const active = p.deviceRun.op !== null && (p.deviceRun.running || p.build.op === null || p.deviceRun.nextId >= p.build.nextId) ? p.deviceRun : p.build;
  const summary = summarize(active, active === p.build ? p.diagnostics : []);
  const stages = stageProgress(
    active.op,
    active.lines.map((l) => l.text),
    active.running,
    active.outcome ? { code: active.outcome.code, cancelled: active.outcome.cancelled } : null,
  );

  const submitNew = () => {
    if (blocked || !nameCheck.ok) return;
    p.onRun('new', { name });
    setShowNew(false);
    setName('');
  };

  return (
    <div className="bs">
      <section aria-label="Derleme özeti">
        <dl className="bs-summary" aria-live="polite">
          {p.infoLoading || !p.info ? (
            <Row label="xtool">algılanıyor…</Row>
          ) : (
            <>
              <Row label="xtool" tone={found ? 'ok' : 'warn'}>
                {found ? `Bulundu ${p.versionLabel ?? ''}`.trim() : 'Bulunamadı'}
              </Row>
              <Row label="Swift" tone={p.swiftLabel ? 'ok' : 'warn'}>
                {p.swiftLabel ?? 'PATH içinde yok'}
              </Row>
              <Row label="SDK" tone="off">
                <button type="button" className="tree-link" onClick={() => p.onRun('sdk-status', {})} disabled={blocked !== null} title={blocked ?? 'SDK durumunu denetle'}>
                  Denetle
                </button>
              </Row>
              <Row label="Cihaz" tone={p.deviceName ? 'ok' : 'off'}>
                {p.deviceName ?? (
                  <button type="button" className="tree-link" onClick={p.onShowDevices}>
                    Bağlı değil, Cihazlar’a bak
                  </button>
                )}
              </Row>
            </>
          )}
        </dl>
        {p.info && !found && (
          <details className="bs-help" open>
            <summary>xtool nasıl kurulur?</summary>
            <p>github.com/xtool-org/xtool adresindeki Linux kurulum belgesini izleyin. Apple SDK’yı <code>xtool setup</code> ile kurarsınız; Studio Apple kimlik bilgilerini görmez.</p>
            {p.info.error && <p className="bs-muted">{p.info.error}</p>}
          </details>
        )}
        {found && p.compatibility !== 'tested' && (
          <details className="bs-help">
            <summary>{p.compatibility === 'untested' ? 'Test edilmemiş xtool sürümü' : 'xtool sürümü belirlenemedi'}</summary>
            <p>Komut seçenekleri ve çıktı biçimi Studio ile doğrulanmadı; hata ayrıştırma farklı olabilir.</p>
          </details>
        )}
      </section>

      <section className="bs-target" aria-label="Hedef">
        <span className="bs-label">Yapılandırma</span>
        <div className="seg" role="radiogroup" aria-label="Yapılandırma">
          {(['debug', 'release'] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={configuration === c} className={configuration === c ? 'on' : ''} onClick={() => setConfiguration(c)}>
              {c}
            </button>
          ))}
        </div>
      </section>

      <section className="bs-actions" aria-label="Derleme işlemleri">
        <button type="button" className="primary wide" onClick={() => p.onInstall(configuration)} disabled={p.installBlocked !== null || blocked !== null} title={blocked ?? p.installBlocked ?? 'Derler, iPhone’a yükler ve başlatır'}>
          Derle ve Yükle
        </button>
        {(p.installBlocked || blocked) && !running && <p className="bs-why">{blocked ?? p.installBlocked}</p>}
        <div className="bs-secondary">
          <button type="button" onClick={() => p.onRun('build', { project, configuration })} disabled={blocked !== null} title={blocked ?? 'Yalnızca derler, cihaza yüklemez'}>
            Yalnızca derle
          </button>
          <button type="button" onClick={() => setShowNew((v) => !v)} disabled={blocked !== null} aria-expanded={showNew} title={blocked ?? undefined}>
            Yeni proje
          </button>
          <button type="button" onClick={p.onRedetect} disabled={p.infoLoading || running}>
            Yeniden algıla
          </button>
          <button type="button" onClick={p.onClear} disabled={running || (p.build.lines.length === 0 && p.deviceRun.lines.length === 0)}>
            Temizle
          </button>
          {running && (
            <button type="button" className="danger" onClick={p.onCancel}>
              İptal
            </button>
          )}
        </div>
        {showNew && (
          <div className="bs-new">
            <label>
              Proje adı
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitNew()} aria-invalid={nameError !== null} />
            </label>
            <button type="button" onClick={submitNew} disabled={blocked !== null || !nameCheck.ok} title={blocked ?? nameError ?? undefined}>
              Oluştur
            </button>
            {nameError && (
              <span className="bs-field-error" role="alert">
                {nameError}
              </span>
            )}
          </div>
        )}
        <button type="button" className="tree-link" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          {advanced ? 'Gelişmişi gizle' : 'Gelişmiş'}
        </button>
        {advanced && (
          <label className="bs-adv">
            Proje klasörü
            <input type="text" value={project} placeholder="(çalışma klasörü kökü)" onChange={(e) => setProject(e.target.value)} />
          </label>
        )}
      </section>

      {stages.length > 0 && (
        <ol className="stages" aria-label="Aşamalar" title={STAGE_TITLE}>
          {stages.map((s) => (
            <li key={s.id} className={`stage stage-${s.state}`}>
              <span className="stage-dot" aria-hidden="true" />
              {s.label}
              <span className="sr-only"> ({s.state === 'done' ? 'tamam' : s.state === 'active' ? 'sürüyor' : s.state === 'failed' ? 'başarısız' : 'bekliyor'})</span>
            </li>
          ))}
        </ol>
      )}

      {summary.tone !== 'idle' && (
        <div className={`bs-result bs-${summary.tone}`} role="status">
          <strong>{summary.title}</strong>
          {summary.detail && <span>{summary.detail}</span>}
          {(summary.tone === 'error' || summary.tone === 'success') && (
            <button type="button" className="tree-link" onClick={p.onShowOutput}>
              {summary.tone === 'error' ? 'Ayrıntıları göster' : 'Çıktıyı göster'}
            </button>
          )}
        </div>
      )}

      <p className="bs-muted bs-foot">Derlemenin başarılı olması App Store uygunluğu anlamına gelmez; App Store hazırlığını ve Güvenlik merkezini ayrıca kontrol edin.</p>
    </div>
  );
}
