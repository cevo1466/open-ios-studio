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
  const bundleError = bundleId.length > 0 && !bundleOk ? 'Bundle id may contain letters, digits, dots and dashes only (max 155 characters).' : null;
  const launchBase = canRunOnDevice({
    xtoolFound: props.xtoolFound,
    hasWorkspace: true,
    running,
    authLoggedIn: props.authLoggedIn,
    devices,
    selectedUdid,
  });
  const launchReason = launchBase.reason ?? (bundleOk ? null : 'Enter a valid bundle id first.');

  const submitLaunch = () => {
    if (launchReason) return;
    props.onLaunch(selectedUdid, bundleId);
  };

  return (
    <section className="dp-panel" aria-label="Devices panel">
      <div className="dp-head">
        <h2>Devices</h2>
        <button type="button" onClick={props.onClose} aria-label="Close devices panel">
          Close
        </button>
      </div>

      <div className={`dp-banner dp-banner-${status.kind}`} role="status">
        <div className="dp-banner-title">{status.title}</div>
        <div className="dp-banner-detail">{status.detail}</div>
      </div>

      <div className="dp-section">
        <h3>Signing status</h3>
        <pre className="dp-auth" aria-label="xtool auth status output">
          {props.authText && props.authText.trim() !== '' ? props.authText : 'No output from xtool auth status yet.'}
        </pre>
        <p className="dp-note">
          Credentials are handled by xtool in your own terminal only. Open iOS Studio never sees or stores them.
        </p>
      </div>

      <div className="dp-section">
        <h3>Connected devices</h3>
        {devices && devices.length > 0 ? (
          <ul className="dp-list" role="radiogroup" aria-label="Devices">
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
          <div className="dp-empty">{props.loading ? 'Checking...' : 'No devices to show.'}</div>
        )}
      </div>

      <div className="dp-actions" role="toolbar" aria-label="Device actions">
        <button type="button" onClick={props.onRefresh} disabled={props.loading || running} title={running ? 'A run is active.' : undefined}>
          Refresh
        </button>
        <label>
          Configuration
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
          Build and run on device
        </button>
      </div>

      <div className="dp-actions">
        <label>
          Bundle id
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
          Launch installed app
        </button>
        {bundleError && (
          <span className="dp-error" role="alert">
            {bundleError}
          </span>
        )}
      </div>

      <p className="dp-honesty">There is no iOS Simulator on Linux. Runs happen on a real iPhone via xtool.</p>
      <p className="dp-honesty">Device runs were not verified in CI (no device available).</p>
    </section>
  );
}
