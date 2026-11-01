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
      title: 'xtool bulunamadı',
      detail: 'Cihaz özellikleri için xtool gerekir ve PATH içinde olmalıdır. xtool\'u kurun, sonra Derleme panelinden "Yeniden algıla" düğmesine basın.',
    };
  }
  if (input.loading) {
    return { kind: 'checking', title: 'Cihazlar denetleniyor...', detail: 'Bağlı cihazlar ve imzalama durumu xtool\'a soruluyor.' };
  }
  if (input.error) {
    return { kind: 'error', title: 'Cihazlar sorgulanamadı', detail: input.error };
  }
  if (input.devices === null) {
    return { kind: 'checking', title: 'Henüz denetlenmedi', detail: 'Bağlı cihazları aramak için Yenile düğmesine basın.' };
  }
  if (input.devices.length === 0) {
    return {
      kind: 'no-device',
      title: 'iPhone algılanmadı',
      detail:
        'iPhone\'unuzu USB ile bağlayın, kilidini açın ve sorulursa Güven\'e (Trust) dokunun. Telefonda Geliştirici Modu\'nu (Developer Mode) açın: Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu. Bu bilgisayarda usbmuxd çalıştığından emin olun, sonra Yenile\'ye basın.',
    };
  }
  if (input.authLoggedIn !== true) {
    return {
      kind: 'not-signed-in',
      title: 'xtool oturumu açık değil',
      detail:
        'Open iOS Studio Apple kimlik bilgilerini hiçbir zaman görmez. Kendi terminalinizde `xtool setup` (veya `xtool auth login`) komutunu çalıştırın, sonra Yenile\'ye basın.',
    };
  }
  return {
    kind: 'ready',
    title: input.devices.length === 1 ? '1 iPhone hazır' : `${input.devices.length} iPhone hazır`,
    detail: 'Cihaz bağlı ve xtool oturumu açık. Cihazda çalıştırma henüz CI\'da doğrulanmadı; ilk denemede sorun çıkabilir.',
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
  if (!input.xtoolFound) return no('xtool bulunamadı.');
  if (input.running) return no('Zaten çalışan bir işlem var. İptal edin veya bitmesini bekleyin.');
  if (!input.hasWorkspace) return no('Önce bir çalışma klasörü açın.');
  if (!input.devices || input.devices.length === 0) return no('iPhone algılanmadı.');
  if (input.authLoggedIn !== true) {
    return no('Oturum açık değil. Kendi terminalinizde `xtool setup` çalıştırın, sonra Yenile\'ye basın.');
  }
  if (input.selectedUdid !== null && !input.devices.some((d) => d.udid === input.selectedUdid)) {
    return no('Seçili cihazın bağlantısı kesildi. Başka bir cihaz seçin.');
  }
  if (input.selectedUdid === null && input.devices.length > 1) return no('Önce bir cihaz seçin.');
  return { ok: true, reason: null };
}

export function shortUdid(udid: string): string {
  if (udid.length <= 13) return udid;
  return `${udid.slice(0, 8)}…${udid.slice(-4)}`;
}
