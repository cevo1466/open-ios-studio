import type { ProviderId } from './types';

export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

/** Reasoning effort levels the official CLIs accept. Empty = the CLI default. */
export const EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const DEFAULT_CHOICE: Choice = { value: '', label: 'Varsayılan', hint: 'CLI kendi varsayılanını kullanır' };

const EFFORT_LABELS: Record<string, Choice> = {
  low: { value: 'low', label: 'Düşük', hint: 'En hızlı, az düşünür' },
  medium: { value: 'medium', label: 'Orta', hint: 'Dengeli' },
  high: { value: 'high', label: 'Yüksek', hint: 'Daha derin düşünür, daha yavaş' },
  xhigh: { value: 'xhigh', label: 'Çok yüksek', hint: 'Zor işler için' },
  max: { value: 'max', label: 'Maksimum', hint: 'En derin, en yavaş' },
};

const MODEL_CHOICES: Partial<Record<ProviderId, Choice[]>> = {
  'claude-cli': [
    DEFAULT_CHOICE,
    { value: 'sonnet', label: 'Sonnet', hint: 'Hızlı ve dengeli, günlük işler için' },
    { value: 'opus', label: 'Opus', hint: 'En güçlü, daha yavaş' },
    { value: 'haiku', label: 'Haiku', hint: 'En hızlı, basit işler için' },
  ],
  // Codex model names change often; the user can type one under "Özel".
  'codex-cli': [DEFAULT_CHOICE],
};

const EFFORT_CHOICES: Partial<Record<ProviderId, string[]>> = {
  'claude-cli': ['low', 'medium', 'high', 'xhigh', 'max'],
  'codex-cli': ['low', 'medium', 'high'],
};

/** Ready-made model list for a provider, or null when the provider uses a free-text model name. */
export function modelChoices(provider: ProviderId): Choice[] | null {
  return MODEL_CHOICES[provider] ?? null;
}

/** Effort levels a provider supports, or null when it has no effort setting. */
export function effortChoices(provider: ProviderId): Choice[] | null {
  const list = EFFORT_CHOICES[provider];
  if (!list) return null;
  return [DEFAULT_CHOICE, ...list.map((v) => EFFORT_LABELS[v])];
}

export function isKnownEffort(value: string): boolean {
  return (EFFORT_VALUES as readonly string[]).includes(value);
}

/** Short label for a chip, for example "Opus · Yüksek". */
export function describeChoice(provider: ProviderId, model: string, effort: string): string {
  const m = modelChoices(provider)?.find((c) => c.value === model);
  const e = effortChoices(provider)?.find((c) => c.value === effort && c.value !== '');
  const parts = [m && m.value ? m.label : model, e ? e.label : ''].filter(Boolean);
  return parts.join(' · ');
}
