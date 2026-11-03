import { useState } from 'react';
import { ipc, type UpdateAssetKind, type UpdateDownload, type UpdateInfo } from '../ipc';

interface Props {
  /** False in a plain browser: the check needs the Rust side. */
  desktop: boolean;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Which package to offer first: the one matching how this copy was installed. */
export function preferredKind(info: UpdateInfo): UpdateAssetKind {
  if (info.installKind === 'app-image') return 'app-image';
  return 'deb';
}

/** Settings section: check GitHub for a newer release, download it verified, and (AppImage) replace in place. */
export function UpdatesSection({ desktop }: Props) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<UpdateAssetKind | null>(null);
  const [download, setDownload] = useState<UpdateDownload | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    setDownload(null);
    setApplied(null);
    try {
      setInfo(await ipc.updateCheck());
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const fetchKind = async (kind: UpdateAssetKind) => {
    setDownloading(kind);
    setError(null);
    try {
      setDownload(await ipc.updateDownload(kind));
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(null);
    }
  };

  const apply = async () => {
    if (!download) return;
    setError(null);
    try {
      setApplied(await ipc.updateApplyAppimage(download.path, download.sha256));
    } catch (e) {
      setError(String(e));
    }
  };

  const hasDeb = info?.assets.some((a) => a.kind === 'deb') ?? false;
  const hasAppImage = info?.assets.some((a) => a.kind === 'app-image') ?? false;
  const preferred = info ? preferredKind(info) : 'deb';

  return (
    <section className="upd" aria-labelledby="upd-title">
      <h3 id="upd-title">Güncellemeler</h3>
      <div className="row upd-row">
        <span className="muted">
          {info ? `Kurulu: ${info.current} · Son sürüm: ${info.latest}${info.prerelease ? ' (ön sürüm)' : ''}` : 'GitHub sürümleri ile karşılaştırır; hiçbir şeyi kendiliğinden kurmaz.'}
        </span>
        <button type="button" onClick={() => void check()} disabled={!desktop || checking} title={desktop ? 'github.com/cevo1466/open-ios-studio sürümlerini sorgular' : 'Yalnızca masaüstü uygulaması'}>
          {checking ? 'Denetleniyor…' : info ? 'Yeniden denetle' : 'Güncellemeleri denetle'}
        </button>
      </div>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      {info && !info.newer && (
        <p className="upd-ok" role="status">
          Güncelsiniz. {formatDate(info.publishedAt) ? `Son sürüm ${formatDate(info.publishedAt)} tarihinde yayımlandı.` : ''}
        </p>
      )}
      {info && info.newer && !download && (
        <div className="upd-new" role="status">
          <p>
            <strong>Yeni sürüm var: {info.latest}</strong>
            {formatDate(info.publishedAt) && <span className="muted"> · {formatDate(info.publishedAt)}</span>}
          </p>
          <p className="muted">
            Dosya indirilir, SHA-256 özeti sürümün SHA256SUMS.txt dosyasıyla doğrulanır ve İndirilenler klasörüne kaydedilir. Sürüm notları: {info.htmlUrl}
          </p>
          <div className="row">
            {hasDeb && (
              <button type="button" className={preferred === 'deb' ? 'primary' : ''} onClick={() => void fetchKind('deb')} disabled={downloading !== null}>
                {downloading === 'deb' ? 'İndiriliyor…' : `DEB indir (${formatSize(info.assets.find((a) => a.kind === 'deb')?.size ?? 0)})`}
              </button>
            )}
            {hasAppImage && (
              <button type="button" className={preferred === 'app-image' ? 'primary' : ''} onClick={() => void fetchKind('app-image')} disabled={downloading !== null}>
                {downloading === 'app-image' ? 'İndiriliyor…' : `AppImage indir (${formatSize(info.assets.find((a) => a.kind === 'app-image')?.size ?? 0)})`}
              </button>
            )}
            {!hasDeb && !hasAppImage && <span className="muted">Bu sürümde indirilebilir paket yok.</span>}
          </div>
        </div>
      )}
      {download && (
        <div className="upd-done" role="status">
          <p>
            <strong>İndirildi ve doğrulandı:</strong> {download.name}
          </p>
          <p className="muted upd-path">{download.path}</p>
          {download.installCommand && (
            <>
              <p>Kurmak için terminalde çalıştırın (yönetici parolası ister):</p>
              <pre className="upd-cmd">{download.installCommand}</pre>
            </>
          )}
          {!download.installCommand && !download.canReplaceRunningAppimage && (
            <p>Yeni AppImage’ı eskisinin yerine koyun ve uygulamayı yeniden başlatın.</p>
          )}
          {applied ? (
            <p className="upd-ok">Çalışan AppImage güncellendi: {applied}. Değişiklik için uygulamayı kapatıp yeniden açın.</p>
          ) : (
            <div className="row">
              {download.canReplaceRunningAppimage && (
                <button type="button" className="primary" onClick={() => void apply()}>
                  Çalışan AppImage’ın yerine koy
                </button>
              )}
              <button type="button" onClick={() => void ipc.updateReveal(download.path).catch((e: unknown) => setError(String(e)))}>
                Klasörü aç
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
