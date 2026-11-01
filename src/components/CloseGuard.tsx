import { useEffect, useRef } from 'react';
import type { Tab } from '../state/store';

interface Props {
  dirty: Tab[];
  busy: boolean;
  error: string | null;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancel: () => void;
}

/** Shown when the window is asked to close while files have unsaved changes. */
export function CloseGuardDialog({ dirty, busy, error, onSaveAndClose, onDiscardAndClose, onCancel }: Props) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => saveRef.current?.focus(), []);
  return (
    <div className="overlay">
      <div
        className="dialog"
        role="alertdialog"
        aria-label="Kaydedilmemiş değişiklikler"
        onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}
      >
        <h2>Kaydedilmemiş değişiklikler</h2>
        <p>
          {dirty.length} dosyada kaydedilmemiş değişiklik var:
        </p>
        <ul className="muted">
          {dirty.slice(0, 8).map((t) => (
            <li key={t.path}>{t.path}</li>
          ))}
          {dirty.length > 8 && <li>… ve {dirty.length - 8} dosya daha</li>}
        </ul>
        {error && <p role="alert">{error}</p>}
        <div className="row">
          <button type="button" ref={saveRef} onClick={onSaveAndClose} disabled={busy}>
            Tümünü kaydet ve kapat
          </button>
          <button type="button" onClick={onDiscardAndClose} disabled={busy}>
            Kaydetmeden kapat
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Vazgeç
          </button>
        </div>
      </div>
    </div>
  );
}
