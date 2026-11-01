import { useState } from 'react';
import { canRunOnDevice, deviceStatus, shortUdid } from '../xtool/deviceView';
import type { Device } from '../xtool/types';
import '../devices-panel.css';

export interface DevicesPanelProps {
  xtoolFound: boolean;
  devices: Device[] | null;
  authText: string | null;
  authLoggedIn: boolean | null;
  loading: boolean;
  error: string | null;
  hasWorkspace: boolean;
  running: boolean;
  selectedUdid: string | null;
  onSelect(udid: string | null): void;
  onRefresh(): void;
  onRunOnDevice(udid: string | null, configuration: 'debug' | 'release'): void;
  onLaunch(udid: string | null, bundleId: string): void;
  onClose(): void;
}

const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;

export function DevicesPanel(props: DevicesPanelProps) {
  const { devices, selectedUdid, running } = props;
  const [configuration, setConfiguration] = useState<'debug' | 'release'>('debug');
  const [bundleId, setBundleId] = useState('');

  const status = deviceStatus({
    xtoolFound: props.xtoolFound,
    authLoggedIn: props.authLoggedIn,
    devices,
    loading: props.loading,
    error: props.error,
  });
  const run = canRunOnDevice({
    xtoolFound: props.xtoolFound,
    hasWorkspace: props.hasWorkspace,
    running,
    authLoggedIn: props.authLoggedIn,
    devices,
    selectedUdid,
  });

  const bundleOk = BUNDLE_ID_RE.test(bundleId);
  const bundleError = bundleId.length > 0 && !bundleOk ? 'Bundle kimliği yalnızca harf, rakam, nokta ve tire içerebilir (en fazla 155 karakter).' : null;
  const launchBase = canRunOnDevice({
    xtoolFound: props.xtoolFound,
    hasWorkspace: true,
    running,
    authLoggedIn: props.authLoggedIn,
    devices,
    selectedUdid,
  });
  const launchReason = launchBase.reason ?? (bundleOk ? null : 'Önce geçerli bir bundle kimliği girin.');

  const submitLaunch = () => {
    if (launchReason) return;
    props.onLaunch(selectedUdid, bundleId);
  };

  return (
    <section className="dp-panel" aria-label="Cihazlar paneli">
      <div className="dp-head">
        <h2>Cihazlar</h2>
        <button type="button" onClick={props.onClose} aria-label="Cihazlar panelini kapat">
          Kapat
        </button>
      </div>

      <div className={`dp-banner dp-banner-${status.kind}`} role="status">
        <div className="dp-banner-title">{status.title}</div>
        <div className="dp-banner-detail">{status.detail}</div>
      </div>

      <div className="dp-section">
        <h3>İmzalama durumu</h3>
        <pre className="dp-auth" aria-label="xtool auth status çıktısı">
          {props.authText && props.authText.trim() !== '' ? props.authText : 'xtool auth status henüz çıktı vermedi.'}
        </pre>
        <p className="dp-note">
          Apple kimlik bilgileri yalnızca sizin terminalinizde xtool tarafından işlenir. Open iOS Studio bunları görmez ve saklamaz.
        </p>
      </div>

      <div className="dp-section">
        <h3>Bağlı cihazlar</h3>
        {devices && devices.length > 0 ? (
          <ul className="dp-list" role="radiogroup" aria-label="Cihazlar">
            {devices.map((d) => (
              <li key={d.udid}>
                <label className="dp-device">
                  <input
                    type="radio"
                    name="dp-device"
                    checked={selectedUdid === d.udid}
                    onChange={() => props.onSelect(d.udid)}
                  />
                  <span>{d.name}</span>
                  <span className="dp-badge">{d.connection}</span>
                  <span className="dp-udid" title={d.udid}>
                    {shortUdid(d.udid)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dp-empty">{props.loading ? 'Denetleniyor...' : 'Gösterilecek cihaz yok.'}</div>
        )}
      </div>

      <div className="dp-actions" role="toolbar" aria-label="Cihaz işlemleri">
        <button type="button" onClick={props.onRefresh} disabled={props.loading || running} title={running ? 'Çalışan bir işlem var.' : undefined}>
          Yenile
        </button>
        <label>
          Yapılandırma
          <select value={configuration} onChange={(e) => setConfiguration(e.target.value as 'debug' | 'release')}>
            <option value="debug">debug</option>
            <option value="release">release</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => props.onRunOnDevice(selectedUdid, configuration)}
          disabled={!run.ok}
          title={run.reason ?? undefined}
        >
          Derle ve cihazda çalıştır
        </button>
      </div>

      <div className="dp-actions">
        <label>
          Bundle kimliği
          <input
            type="text"
            value={bundleId}
            placeholder="com.example.app"
            onChange={(e) => setBundleId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitLaunch()}
            aria-invalid={bundleError !== null}
          />
        </label>
        <button type="button" onClick={submitLaunch} disabled={launchReason !== null} title={launchReason ?? undefined}>
          Yüklü uygulamayı başlat
        </button>
        {bundleError && (
          <span className="dp-error" role="alert">
            {bundleError}
          </span>
        )}
      </div>

      <p className="dp-honesty">Linux'ta iOS Simülatörü yoktur. Uygulamalar xtool aracılığıyla gerçek bir iPhone'da çalışır.</p>
      <p className="dp-honesty">Cihazda çalıştırma CI'da doğrulanmadı (CI'da cihaz yok).</p>
    </section>
  );
}
