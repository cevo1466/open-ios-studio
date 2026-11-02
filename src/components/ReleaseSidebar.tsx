import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipc } from '../ipc';
import { bumpBuild, bundleIdFromXtoolYml, defaultConfig, parseConfig, RELEASE_CONFIG_PATH, serializeConfig, validateConfig, type ReleaseConfig } from '../release/config';
import { explainError } from '../release/errors';
import { releasePaths } from '../release/paths';
import { preflight, preflightBlocks, type Check } from '../release/preflight';
import { APPLE_UNVERIFIED, buildSteps, type StepId } from '../release/steps';
import type { AscStatus } from '../release/types';
import type { BuildState } from '../xtool/buildState';
import '../build-panel.css';
import '../release-panel.css';

export interface ReleaseSidebarProps {
  desktop: boolean;
  hasWorkspace: boolean;
  xtoolFound: boolean;
  /** Last build/sdk/new run: the release build is tracked through it (shared Output log). */
  build: BuildState;
  onBuildRelease(project: string): void;
  onCancel(): void;
}

interface Message {
  tone: 'success' | 'error' | 'running';
  title: string;
  detail?: string;
}

const FIELD_LABELS: Array<[keyof ReleaseConfig, string, string]> = [
  ['bundleId', 'Bundle id', 'com.firma.uygulama'],
  ['appName', 'Paket adı (xtool)', 'MyApp'],
  ['shortVersion', 'Sürüm', '1.0.0'],
  ['email', 'E-posta', 'ad@firma.com'],
  ['project', 'Proje klasörü', '(çalışma klasörü kökü)'],
];

/** Left "Yayın" view: the App Store release steps, in order, with honest status. */
export function ReleaseSidebar(p: ReleaseSidebarProps) {
  const [config, setConfig] = useState<ReleaseConfig>(defaultConfig());
  const [configNote, setConfigNote] = useState<string | null>(null);
  const [asc, setAsc] = useState<AscStatus | null>(null);
  const [done, setDone] = useState<Partial<Record<StepId, boolean>>>({});
  const [running, setRunning] = useState<StepId | null>(null);
  const [failed, setFailed] = useState<StepId | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [keyForm, setKeyForm] = useState(false);
  const [issuerId, setIssuerId] = useState('');
  const [keyId, setKeyId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const errors = useMemo(() => validateConfig(config), [config]);
  const paths = useMemo(() => releasePaths(config), [config]);
  const releaseBuildRunning = p.build.running && p.build.op === 'build-release-ipa';
  const releaseBuildOk = p.build.op === 'build-release-ipa' && p.build.outcome !== null && p.build.outcome.code === 0;
  const releaseBuildFailed = p.build.op === 'build-release-ipa' && p.build.outcome !== null && p.build.outcome.code !== 0;

  const steps = buildSteps({
    desktop: p.desktop,
    hasWorkspace: p.hasWorkspace,
    xtoolFound: p.xtoolFound,
    configValid: errors.length === 0,
    ascConfigured: asc?.configured === true,
    done: { ...done, build: releaseBuildOk || done.build === true },
    running: releaseBuildRunning ? 'build' : running,
    failed: releaseBuildFailed ? 'build' : failed,
  });

  const refreshAsc = useCallback(() => {
    if (!p.desktop) return;
    ipc.ascCredentialsStatus().then(setAsc).catch(() => setAsc({ configured: false, issuerId: null, keyId: null }));
  }, [p.desktop]);

  useEffect(() => {
    refreshAsc();
  }, [refreshAsc]);

  // Load release.json (or prefill the bundle id from xtool.yml) whenever a workspace opens.
  useEffect(() => {
    if (!p.desktop || !p.hasWorkspace) return;
    let cancelled = false;
    void (async () => {
      try {
        const text = await ipc.readFileIfExists(RELEASE_CONFIG_PATH);
        if (cancelled) return;
        if (text !== null) {
          const parsed = parseConfig(text);
          if (parsed.ok) setConfig(parsed.config);
          else setConfigNote(parsed.reason);
          return;
        }
        const yml = await ipc.readFileIfExists('xtool.yml');
        const bundleId = yml === null ? null : bundleIdFromXtoolYml(yml);
        if (!cancelled && bundleId !== null) setConfig((c) => ({ ...c, bundleId }));
      } catch (e) {
        if (!cancelled) setConfigNote(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [p.desktop, p.hasWorkspace]);

  const saveConfig = async (next: ReleaseConfig) => {
    try {
      await ipc.applyFile(RELEASE_CONFIG_PATH, serializeConfig(next));
      setConfigNote(null);
    } catch (e) {
      setConfigNote(String(e));
    }
  };

  const fail = (step: StepId, e: unknown) => {
    const ex = explainError(String(e));
    setFailed(step);
    setMessage({ tone: 'error', title: ex.title, detail: ex.next });
  };

  const run = async (step: StepId, work: () => Promise<void>) => {
    setRunning(step);
    setFailed(null);
    setMessage({ tone: 'running', title: 'Çalışıyor…' });
    setProgress(null);
    try {
      await work();
    } catch (e) {
      fail(step, e);
    } finally {
      setRunning(null);
      setProgress(null);
    }
  };

  const runPreflight = async () => {
    try {
      const scan = await ipc.scanWorkspace();
      setChecks(preflight(config, scan.files));
    } catch (e) {
      setMessage({ tone: 'error', title: 'Ön kontrol çalışmadı.', detail: String(e) });
    }
  };

  const doStep = (id: StepId) => {
    switch (id) {
      case 'settings':
        void saveConfig(config).then(runPreflight);
        break;
      case 'credentials':
        setKeyForm((v) => !v);
        break;
      case 'build':
        void saveConfig(config);
        p.onBuildRelease(config.project);
        break;
      case 'repack':
        void run('repack', async () => {
          const r = await ipc.releaseRepack(config.project, paths.built, paths.repacked, String(config.buildNumber));
          setDone((d) => ({ ...d, repack: true, sign: false, upload: false }));
          setMessage({
            tone: 'success',
            title: 'IPA hazırlandı.',
            detail: `${r.iconsWritten} simge yazıldı${r.privacyManifestAdded ? ', gizlilik manifesti eklendi' : ''}. ${r.warnings.join(' ')}`,
          });
        });
        break;
      case 'prepare':
        void run('prepare', async () => {
          const r = await ipc.releasePrepare(config.bundleId, config.appName, config.email);
          setDone((d) => ({ ...d, prepare: true }));
          setMessage({
            tone: 'success',
            title: r.certificateCreated ? 'Sertifika oluşturuldu, profil hazır.' : 'Mevcut sertifika kullanıldı, profil hazır.',
            detail: `${r.profileName}${r.profileExpires ? ` · bitiş ${r.profileExpires}` : ''}`,
          });
        });
        break;
      case 'sign':
        void run('sign', async () => {
          await ipc.releaseSign(config.bundleId, paths.repacked, paths.signed);
          setDone((d) => ({ ...d, sign: true, upload: false }));
          setMessage({ tone: 'success', title: 'IPA imzalandı.', detail: paths.signed });
        });
        break;
      case 'upload':
        void run('upload', async () => {
          await ipc.releaseUpload(config.bundleId, paths.signed, config.shortVersion, String(config.buildNumber), (e) => {
            if (e.kind === 'part') setProgress(`Parça ${e.done}/${e.total} yüklendi`);
            else if (e.kind === 'committed') setProgress('Yükleme tamamlandı, Apple işliyor…');
            else if (e.kind === 'state') setProgress(`Apple durumu: ${e.state}`);
          });
          const next = bumpBuild(config);
          setConfig(next);
          void saveConfig(next);
          setDone((d) => ({ ...d, build: false, repack: false, sign: false, upload: false }));
          setMessage({ tone: 'success', title: 'Yükleme Apple tarafından işlendi.', detail: `Build ${config.buildNumber} gönderildi; sonraki build numarası ${next.buildNumber}. TestFlight’ta görünmesi birkaç dakika sürebilir.` });
        });
        break;
    }
  };

  const saveKey = async (file: File | undefined) => {
    if (!file) return;
    try {
      const pem = await file.text();
      await ipc.ascCredentialsSet(issuerId, keyId, pem);
      setIssuerId('');
      setKeyId('');
      setKeyForm(false);
      refreshAsc();
      setMessage({ tone: 'success', title: 'Anahtar işletim sistemi anahtarlığına kaydedildi.', detail: 'Doğrulamak için “Bağlantıyı dene”yi kullanın.' });
    } catch (e) {
      fail('credentials', e);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const hasBlockingCheck = checks !== null && preflightBlocks(checks);

  return (
    <div className="bs">
      <section aria-label="Yayın adımları">
        <ol className="rp-steps">
          {steps.map((s) => (
            <li key={s.id} className={`rp-step rp-${s.state}`}>
              <span className="rp-dot" aria-hidden="true" />
              <span className="rp-label">
                <span>{s.label}</span>
                {s.why && <span className="rp-why">{s.why}</span>}
                {s.needsApple && s.state !== 'blocked' && <span className="rp-apple">{APPLE_UNVERIFIED}</span>}
              </span>
              <button type="button" onClick={() => doStep(s.id)} disabled={s.state === 'blocked' || s.state === 'running' || (s.id === 'build' && hasBlockingCheck)} title={s.why ?? (s.id === 'build' && hasBlockingCheck ? 'Ön kontroldaki hataları düzeltin.' : undefined)}>
                {s.state === 'done' ? 'Yeniden' : s.state === 'failed' ? 'Tekrar dene' : s.state === 'running' ? 'Sürüyor' : s.id === 'credentials' ? (asc?.configured ? 'Değiştir' : 'Ekle') : 'Çalıştır'}
              </button>
            </li>
          ))}
        </ol>
        {(running !== null || releaseBuildRunning) && (
          <button type="button" className="danger" onClick={p.onCancel} disabled={running !== null}>
            Derlemeyi iptal et
          </button>
        )}
        {progress && <p className="rp-progress" aria-live="polite">{progress}</p>}
      </section>

      <section aria-label="Yayın ayarları" className="rp-form">
        {FIELD_LABELS.map(([key, label, placeholder]) => (
          <label key={key}>
            {label}
            <input type="text" value={String(config[key])} placeholder={placeholder} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} />
          </label>
        ))}
        <label>
          Build numarası
          <input type="number" min={1} value={Number.isNaN(config.buildNumber) ? '' : config.buildNumber} onChange={(e) => setConfig({ ...config, buildNumber: Number(e.target.value) })} />
        </label>
        {errors.length > 0 && (
          <ul className="bs-field-error" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {configNote && <p className="bs-why">{configNote}</p>}
        <p className="bs-muted">Bu ayarlar <code>{RELEASE_CONFIG_PATH}</code> dosyasına yazılır; Apple anahtarı oraya yazılmaz.</p>
      </section>

      {keyForm && (
        <section aria-label="App Store Connect anahtarı" className="rp-form">
          <label>
            Issuer ID
            <input type="text" value={issuerId} onChange={(e) => setIssuerId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            Key ID
            <input type="text" value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            .p8 dosyası
            <input ref={fileRef} type="file" accept=".p8" disabled={issuerId.trim() === '' || keyId.trim() === ''} onChange={(e) => void saveKey(e.target.files?.[0])} />
          </label>
          <p className="bs-muted">Dosya yalnızca bir kez Rust’a iletilir ve işletim sistemi anahtarlığına yazılır; ekranda gösterilmez, geri okunamaz.</p>
        </section>
      )}

      {asc?.configured && (
        <div className="bs-secondary">
          <span className="bs-muted">Anahtar: {asc.keyId}</span>
          <button type="button" onClick={() => void run('credentials', async () => { await ipc.ascTest(); setMessage({ tone: 'success', title: 'Apple anahtarı kabul etti.' }); })} disabled={running !== null}>
            Bağlantıyı dene
          </button>
          <button type="button" onClick={() => void ipc.ascCredentialsDelete().then(refreshAsc)} disabled={running !== null}>
            Anahtarı sil
          </button>
        </div>
      )}

      {checks && (
        <ul className="rp-checks" aria-label="Ön kontrol">
          {checks.map((c) => (
            <li key={c.id} className="rp-check">
              <strong className={`rp-${c.status}`}>{c.status}</strong>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <div className={`bs-result bs-${message.tone}`} role="status">
          <strong>{message.title}</strong>
          {message.detail && <span>{message.detail}</span>}
        </div>
      )}

      <p className="bs-muted bs-foot">
        Derleme başarılı olsa bile App Store kabulü garanti değildir. Simge (Assets.car), gizlilik içeriği ve inceleme kuralları Apple tarafında denetlenir. Studio, Apple tarafında hiçbir sertifikayı ya da profili silmez veya iptal etmez.
      </p>
    </div>
  );
}
