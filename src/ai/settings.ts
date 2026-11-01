import { PROVIDERS, type ProviderId } from './types';

export interface AiSettings {
  provider: ProviderId;
  /** Model id per provider. Never hard-coded: the user types or picks one. */
  models: Record<ProviderId, string>;
  maxContextTokens: number;
  /** Free-form project notes sent as context. */
  notes: string;
}

export const MIN_CONTEXT_TOKENS = 4000;
export const MAX_CONTEXT_TOKENS = 120000;
export const MAX_NOTES_CHARS = 2000;
const KEY = 'open-ios-studio.ai.v1';

export const defaultAiSettings: AiSettings = {
  provider: 'anthropic',
  models: { anthropic: '', openai: '', ollama: '', 'claude-cli': '', 'codex-cli': '' },
  maxContextTokens: 24000,
  notes: '',
};

export function clampContextTokens(n: number): number {
  if (!Number.isFinite(n)) return defaultAiSettings.maxContextTokens;
  return Math.min(MAX_CONTEXT_TOKENS, Math.max(MIN_CONTEXT_TOKENS, Math.round(n)));
}

export function parseAiSettings(raw: string | null): AiSettings {
  if (!raw) return defaultAiSettings;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return defaultAiSettings;
    const o = v as Record<string, unknown>;
    const provider = PROVIDERS.find((p) => p === o.provider) ?? defaultAiSettings.provider;
    const models: Record<ProviderId, string> = { ...defaultAiSettings.models };
    if (typeof o.models === 'object' && o.models !== null) {
      const m = o.models as Record<string, unknown>;
      for (const p of PROVIDERS) {
        const x = m[p];
        if (typeof x === 'string') models[p] = x.slice(0, 200);
      }
    }
    const maxContextTokens =
      typeof o.maxContextTokens === 'number' ? clampContextTokens(o.maxContextTokens) : defaultAiSettings.maxContextTokens;
    const notes = typeof o.notes === 'string' ? o.notes.slice(0, MAX_NOTES_CHARS) : '';
    return { provider, models, maxContextTokens, notes };
  } catch {
    return defaultAiSettings;
  }
}

export function loadAiSettings(): AiSettings {
  try {
    return parseAiSettings(localStorage.getItem(KEY));
  } catch {
    return defaultAiSettings;
  }
}

/** Persists settings only. API keys are never stored here (they live in the OS keyring). */
export function saveAiSettings(s: AiSettings): void {
  try {
    const safe: AiSettings = {
      provider: s.provider,
      models: s.models,
      maxContextTokens: clampContextTokens(s.maxContextTokens),
      notes: s.notes.slice(0, MAX_NOTES_CHARS),
    };
    localStorage.setItem(KEY, JSON.stringify(safe));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
