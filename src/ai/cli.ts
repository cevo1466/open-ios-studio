import type { CliProviderId, CliStatus, ProviderId, PtyKind } from './types';

/** Pure helpers for the subscription (CLI) providers, kept free of IPC so they are unit-tested. */

export function isCliProvider(p: ProviderId): p is CliProviderId {
  return p === 'claude-cli' || p === 'codex-cli';
}

export const CLI_COMMAND: Record<CliProviderId, string> = {
  'claude-cli': 'claude auth login',
  'codex-cli': 'codex login',
};

export const CLI_TERMINAL_KIND: Record<CliProviderId, PtyKind> = {
  'claude-cli': 'claude-login',
  'codex-cli': 'codex-login',
};

export type CliBadge = 'unknown' | 'missing' | 'logged-out' | 'ready';

export function cliBadge(status: CliStatus | null): CliBadge {
  if (!status) return 'unknown';
  if (!status.installed) return 'missing';
  if (status.loggedIn === true) return 'ready';
  if (status.loggedIn === false) return 'logged-out';
  return 'unknown';
}

export const CLI_BADGE_TEXT: Record<CliBadge, string> = {
  unknown: 'durum bilinmiyor',
  missing: 'CLI kurulu değil',
  'logged-out': 'giriş yapılmamış',
  ready: 'giriş yapıldı',
};

/** Why sending is blocked for a CLI provider, or null when it can go ahead. */
export function cliBlockedReason(p: CliProviderId, status: CliStatus | null): string | null {
  const badge = cliBadge(status);
  if (badge === 'ready') return null;
  if (badge === 'missing') return `\`${p === 'claude-cli' ? 'claude' : 'codex'}\` komutu kurulu değil.`;
  if (badge === 'logged-out') return 'Önce abonelik girişini yapın (Terminalde giriş yap), sonra Durumu yenile.';
  return 'Giriş durumu henüz okunamadı. Durumu yenileyin.';
}

/** True when the CLI says it is signed in with an API key rather than a subscription (billing warning). */
export function looksLikeApiKeyLogin(status: CliStatus | null): boolean {
  return !!status && /api key/i.test(status.detail);
}
