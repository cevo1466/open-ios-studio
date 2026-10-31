import type { Device } from './types';

export type DeviceStatusKind = 'xtool-missing' | 'checking' | 'error' | 'no-device' | 'not-signed-in' | 'ready';

export interface DeviceStatusInput {
  xtoolFound: boolean;
  authLoggedIn: boolean | null;
  devices: Device[] | null;
  loading: boolean;
  error: string | null;
}

export interface DeviceStatus {
  kind: DeviceStatusKind;
  title: string;
  detail: string;
}

export function deviceStatus(input: DeviceStatusInput): DeviceStatus {
  if (!input.xtoolFound) {
    return {
      kind: 'xtool-missing',
      title: 'xtool not found',
      detail: 'Device features need xtool on your PATH. Install xtool, then re-detect it from the Build panel.',
    };
  }
  if (input.loading) {
    return { kind: 'checking', title: 'Checking devices...', detail: 'Asking xtool for connected devices and signing status.' };
  }
  if (input.error) {
    return { kind: 'error', title: 'Could not query devices', detail: input.error };
  }
  if (input.devices === null) {
    return { kind: 'checking', title: 'Not checked yet', detail: 'Press Refresh to look for connected devices.' };
  }
  if (input.devices.length === 0) {
    return {
      kind: 'no-device',
      title: 'No iPhone detected',
      detail:
        'Connect your iPhone via USB, unlock it, and tap Trust when asked. Enable Developer Mode on the phone (Settings > Privacy & Security > Developer Mode). Make sure usbmuxd is running on this computer, then press Refresh.',
    };
  }
  if (input.authLoggedIn !== true) {
    return {
      kind: 'not-signed-in',
      title: 'Not signed in to xtool',
      detail:
        'Open iOS Studio never handles Apple credentials. Run `xtool setup` (or `xtool auth login`) in your own terminal, then press Re-check.',
    };
  }
  return {
    kind: 'ready',
    title: input.devices.length === 1 ? '1 iPhone ready' : `${input.devices.length} iPhones ready`,
    detail: 'A device is connected and xtool is signed in. Runs on a device have not been verified in CI.',
  };
}

export interface CanRunInput {
  xtoolFound: boolean;
  hasWorkspace: boolean;
  running: boolean;
  authLoggedIn: boolean | null;
  devices: Device[] | null;
  selectedUdid: string | null;
}

export function canRunOnDevice(input: CanRunInput): { ok: boolean; reason: string | null } {
  const no = (reason: string) => ({ ok: false, reason });
  if (!input.xtoolFound) return no('xtool was not found.');
  if (input.running) return no('A run is already active. Cancel it or wait for it to finish.');
  if (!input.hasWorkspace) return no('Open a workspace folder first.');
  if (!input.devices || input.devices.length === 0) return no('No iPhone detected.');
  if (input.authLoggedIn !== true) {
    return no('Not signed in. Run `xtool setup` in your own terminal, then press Re-check.');
  }
  if (input.selectedUdid !== null && !input.devices.some((d) => d.udid === input.selectedUdid)) {
    return no('The selected device is no longer connected. Select another device.');
  }
  if (input.selectedUdid === null && input.devices.length > 1) return no('Select a device first.');
  return { ok: true, reason: null };
}

export function shortUdid(udid: string): string {
  if (udid.length <= 13) return udid;
  return `${udid.slice(0, 8)}…${udid.slice(-4)}`;
}
