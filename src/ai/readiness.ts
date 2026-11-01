import { cliBadge, cliBlockedReason, CLI_BADGE_TEXT, isCliProvider } from './cli';
import type { CliStatus, ProviderId } from './types';

export interface Readiness {
  provider: ProviderId;
  model: string;
  keyStored: boolean | null;
  cliStatus: CliStatus | null;
  hasWorkspace: boolean;
  streaming: boolean;
}

/** Why a message cannot be sent right now, or null. One place for the chat panel and the settings. */
export function sendBlockedReason(r: Readiness): string | null {
  if (!r.hasWorkspace) return 'Önce bir çalışma klasörü açın.';
  if (isCliProvider(r.provider)) return cliBlockedReason(r.provider, r.cliStatus);
  if (!r.model.trim()) return 'Önce bir model seçin veya yazın.';
  if (r.keyStored === false) return 'Önce bu sağlayıcı için bir API anahtarı kaydedin.';
  if (r.streaming) return 'Bir yanıt zaten geliyor.';
  return null;
}

export type SessionTone = 'ok' | 'warn' | 'unknown';

/** Short session state for the chat header and the status bar. */
export function sessionState(r: Pick<Readiness, 'provider' | 'keyStored' | 'cliStatus'>): { label: string; tone: SessionTone } {
  if (isCliProvider(r.provider)) {
    const badge = cliBadge(r.cliStatus);
    return { label: CLI_BADGE_TEXT[badge], tone: badge === 'ready' ? 'ok' : badge === 'unknown' ? 'unknown' : 'warn' };
  }
  if (r.provider === 'ollama') return { label: 'yerel', tone: 'ok' };
  if (r.keyStored === null) return { label: 'durum bilinmiyor', tone: 'unknown' };
  return r.keyStored ? { label: 'anahtar kayıtlı', tone: 'ok' } : { label: 'anahtar yok', tone: 'warn' };
}
