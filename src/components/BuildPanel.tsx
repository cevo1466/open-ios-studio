import { useLayoutEffect, useRef, useState } from 'react';
import type { BuildState } from '../xtool/buildState';
import { validateProjectName } from '../xtool/parse';
import type { Diagnostic, XtoolInfo, XtoolOp, XtoolRunArgs } from '../xtool/types';
import '../build-panel.css';

export interface BuildPanelProps {
  info: XtoolInfo | null;
  infoLoading: boolean;
  compatibility: 'tested' | 'untested' | 'unknown';
  versionLabel: string | null;
  swiftLabel: string | null;
  hasWorkspace: boolean;
  state: BuildState;
  diagnostics: Diagnostic[];
  outcomeLabel: string | null;
  onRedetect(): void;
  onRun(op: XtoolOp, args: XtoolRunArgs): void;
  onCancel(): void;
  onClose(): void;
  onOpenFile(path: string, line: number | null): void;
}

type Tab = 'output' | 'problems';

export function BuildPanel(props: BuildPanelProps) {
  const { info, infoLoading, compatibility, versionLabel, swiftLabel, hasWorkspace, state, diagnostics } = props;
  const [tab, setTab] = useState<Tab>('output');
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [configuration, setConfiguration] = useState<'debug' | 'release'>('debug');
  const [project, setProject] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const found = info?.found === true;
  const nameCheck = validateProjectName(name);
  const nameError = name.length > 0 && !nameCheck.ok ? nameCheck.reason : null;

  let blocked: string | null = null;
  if (state.running) blocked = 'Zaten çalışan bir işlem var. İptal edin veya bitmesini bekleyin.';
  else if (!found) blocked = 'xtool bulunamadı, bu yüzden bu işlem kullanılamıyor.';
  else if (!hasWorkspace) blocked = 'Önce bir çalışma klasörü açın.';

  const onScroll = () => {
    const el = logRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.lines.length, tab]);

  const submitNew = () => {
    if (blocked || !nameCheck.ok) return;
    props.onRun('new', { name });
    setShowNew(false);
    setName('');
  };

  return (
    <section className="bp-panel" aria-label="Derleme paneli">
      <div className="bp-head">
        <h2>Derleme</h2>
        <button type="button" onClick={props.onClose} aria-label="Derleme panelini kapat">
          Kapat
        </button>
      </div>

      <div className="bp-status" aria-live="polite">
        {infoLoading || !info ? (
          <span>xtool algılanıyor...</span>
        ) : found ? (
          <>
            <dl>
              <dt>xtool</dt>
              <dd>Bulundu{info.path ? `: ${info.path}` : ''}</dd>
              <dt>Sürüm</dt>
              <dd>{versionLabel ?? 'bilinmiyor'}</dd>
              <dt>Swift araç zinciri</dt>
              <dd>{swiftLabel ?? 'PATH içinde bulunamadı'}</dd>
            </dl>
            {compatibility !== 'tested' && (
              <div className="bp-warn" role="alert">
                {compatibility === 'untested'
                  ? 'Test edilmemiş sürüm: bu xtool sürümü Open iOS Studio ile doğrulanmadı. Komut seçenekleri, çıktı biçimi ve hata ayrıştırma test edilenden farklı olabilir.'
                  : 'Bilinmeyen sürüm: xtool sürümü belirlenemedi, bu yüzden Open iOS Studio ile uyumluluk doğrulanamadı (komut seçenekleri, çıktı biçimi ve hata ayrıştırma).'}
              </div>
            )}
          </>
        ) : (
          <div className="bp-help">
            <p>
              <strong>Kullanılamıyor:</strong> xtool bulunamadı{info.error ? ` (${info.error})` : ''}. xtool kurulana kadar
              derleme yapılamaz.
            </p>
            <p>
              xtool'u kurmak için github.com/xtool-org/xtool adresindeki Linux kurulum belgelerine bakın. Darwin SDK'yı
              siz, bir Xcode.xip dosyasından <code>xtool sdk install</code> komutuyla kurmalısınız.
            </p>
            <p>
              Open iOS Studio Apple kimlik bilgilerini görmez. <code>xtool setup</code> komutunu kendi terminalinizde çalıştırın.
            </p>
            <p>Swift araç zinciri: {swiftLabel ?? 'PATH içinde bulunamadı'}</p>
          </div>
        )}
      </div>

      <div className="bp-actions" role="toolbar" aria-label="Derleme işlemleri">
        <button type="button" onClick={props.onRedetect} disabled={infoLoading || state.running} title={state.running ? 'Çalışan bir işlem var.' : undefined}>
          Yeniden algıla
        </button>
        <button type="button" onClick={() => props.onRun('sdk-status', {})} disabled={blocked !== null} title={blocked ?? undefined}>
          SDK durumu
        </button>
        <button type="button" onClick={() => setShowNew((v) => !v)} disabled={blocked !== null} title={blocked ?? undefined} aria-expanded={showNew}>
          Yeni proje
        </button>
        {showNew && (
          <span className="bp-actions">
            <label>
              Ad
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitNew()}
                aria-invalid={nameError !== null}
              />
            </label>
            <button type="button" onClick={submitNew} disabled={blocked !== null || !nameCheck.ok} title={blocked ?? nameError ?? undefined}>
              Oluştur
            </button>
            {nameError && <span className="bp-error" role="alert">{nameError}</span>}
          </span>
        )}
        <label>
          Yapılandırma
          <select value={configuration} onChange={(e) => setConfiguration(e.target.value as 'debug' | 'release')}>
            <option value="debug">debug</option>
            <option value="release">release</option>
          </select>
        </label>
        <label>
          Proje klasörü
          <input type="text" value={project} placeholder="(çalışma klasörü kökü)" onChange={(e) => setProject(e.target.value)} />
        </label>
        <button type="button" onClick={() => props.onRun('build', { project, configuration })} disabled={blocked !== null} title={blocked ?? undefined}>
          Derle
        </button>
        {state.running && (
          <button type="button" onClick={props.onCancel}>
            İptal
          </button>
        )}
      </div>

      <div className="bp-tabs" role="tablist" aria-label="Derleme çıktısı">
        <button type="button" role="tab" className="bp-tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>
          Çıktı
        </button>
        <button type="button" role="tab" className="bp-tab" aria-selected={tab === 'problems'} onClick={() => setTab('problems')}>
          Sorunlar ({diagnostics.length})
        </button>
      </div>

      <div className="bp-body" role="tabpanel" ref={logRef} onScroll={onScroll}>
        {tab === 'output' ? (
          <>
            {state.dropped > 0 && <div className="bp-note">Önceki {state.dropped} satır atıldı</div>}
            <pre className="bp-log" aria-label="Derleme günlüğü">
              {state.lines.map((l) => (
                <span key={l.id} className={l.stream === 'stderr' ? 'bp-line-stderr' : 'bp-line-stdout'}>
                  {l.text}
                  {'\n'}
                </span>
              ))}
            </pre>
          </>
        ) : diagnostics.length === 0 ? (
          <div className="bp-note">Bildirilen sorun yok.</div>
        ) : (
          <ul className="bp-problems">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <span className={`bp-badge bp-badge-${d.severity}`}>{d.severity}</span>
                <span>{d.message}</span>
                {d.file && (
                  <button type="button" className="bp-link" onClick={() => props.onOpenFile(d.file as string, d.line)}>
                    {d.file}
                    {d.line !== null ? `:${d.line}` : ''}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.outcomeLabel && (
        <div className="bp-outcome" role="status">
          {props.outcomeLabel}
        </div>
      )}
      <p className="bp-disclaimer">
        Derlemenin başarılı olması App Store uygunluğu anlamına gelmez. App Store Hazırlığı ve Güvenlik Merkezi'ni ayrıca kontrol edin.
      </p>
    </section>
  );
}
