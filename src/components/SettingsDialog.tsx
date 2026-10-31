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
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Settings</h2>
        <label>
          Theme
          <select value={settings.theme} onChange={(e) => onChange({ ...settings, theme: e.target.value as ThemeChoice })}>
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Editor font size
          <input
            type="number"
            min={10}
            max={28}
            value={settings.fontSize}
            onChange={(e) => onChange({ ...settings, fontSize: Number(e.target.value) || settings.fontSize })}
          />
        </label>
        <p className="muted">Settings are stored locally in this app. No API keys or credentials are stored here.</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
