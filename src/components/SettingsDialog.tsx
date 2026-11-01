import type { Settings, ThemeChoice } from '../settings';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onChange, onClose }: Props) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Ayarlar"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Ayarlar</h2>
        <label>
          Tema
          <select value={settings.theme} onChange={(e) => onChange({ ...settings, theme: e.target.value as ThemeChoice })}>
            <option value="system">Sistem</option>
            <option value="light">Açık</option>
            <option value="dark">Koyu</option>
          </select>
        </label>
        <label>
          Yazı boyutu
          <input
            type="number"
            min={10}
            max={28}
            value={settings.fontSize}
            onChange={(e) => onChange({ ...settings, fontSize: Number(e.target.value) || settings.fontSize })}
          />
        </label>
        <p className="muted">Ayarlar bu uygulamada yerel olarak saklanır. Burada API anahtarı veya kimlik bilgisi saklanmaz.</p>
        <button type="button" onClick={onClose}>
          Kapat
        </button>
      </div>
    </div>
  );
}
