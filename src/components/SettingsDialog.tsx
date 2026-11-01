import type { Settings, ThemeChoice } from '../settings';
import { THEMES } from '../theme/themes';

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
            <option value="system">Sistem (işletim sistemini izler)</option>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="theme-grid" role="group" aria-label="Tema örnekleri">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-card${settings.theme === t.id ? ' selected' : ''}`}
              aria-pressed={settings.theme === t.id}
              aria-label={`Tema: ${t.label}`}
              onClick={() => onChange({ ...settings, theme: t.id })}
            >
              <span className="theme-swatch" style={{ background: t.swatch[0] }} aria-hidden="true">
                <i style={{ background: t.swatch[1] }} />
                <i style={{ background: t.swatch[2] }} />
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
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
