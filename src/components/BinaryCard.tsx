import { describeKind, type FileKind } from '../files/kind';
import '../binary-card.css';

interface Props {
  path: string;
  kind: Exclude<FileKind, 'text'>;
  error: string | null;
  onRevealSelf(): void;
  onRevealParent(): void;
  onShowArtifacts(): void;
  onClose(): void;
}

/** Shown instead of the text editor for build output, so binaries never open as garbled text. */
export function BinaryCard({ path, kind, error, onRevealSelf, onRevealParent, onShowArtifacts, onClose }: Props) {
  const info = describeKind(kind);
  const name = path.split('/').pop() ?? path;
  return (
    <section className="bin-card" aria-label="Dosya bilgisi">
      <div className="bin-box">
        <h2>
          {name} <span className="bin-kind">{info.title}</span>
        </h2>
        <p>{info.lead}</p>
        <p className="bin-path">{path}</p>
        <div className="bin-actions">
          <button type="button" className="primary" onClick={onRevealSelf}>
            Dosya yöneticisinde aç
          </button>
          <button type="button" onClick={onRevealParent}>
            Bulunduğu klasörü göster
          </button>
          <button type="button" onClick={onShowArtifacts}>
            Build çıktılarında göster
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Kapat
          </button>
        </div>
        {error && (
          <p className="bin-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
