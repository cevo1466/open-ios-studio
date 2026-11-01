import { describe, expect, it } from 'vitest';
import { describeChoice, effortChoices, isKnownEffort, modelChoices } from './models';

describe('model and effort choices', () => {
  it('offers Sonnet, Opus and Haiku for Claude', () => {
    const values = modelChoices('claude-cli')?.map((c) => c.value);
    expect(values).toEqual(['', 'sonnet', 'opus', 'haiku']);
  });
  it('has no preset model list for API providers', () => {
    expect(modelChoices('anthropic')).toBeNull();
    expect(effortChoices('ollama')).toBeNull();
  });
  it('lists the effort levels each CLI supports', () => {
    expect(effortChoices('claude-cli')?.map((c) => c.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortChoices('codex-cli')?.map((c) => c.value)).toEqual(['', 'low', 'medium', 'high']);
  });
  it('validates effort ids', () => {
    expect(isKnownEffort('high')).toBe(true);
    expect(isKnownEffort('--bad')).toBe(false);
  });
  it('describes the current choice', () => {
    expect(describeChoice('claude-cli', 'opus', 'high')).toBe('Opus · Yüksek');
    expect(describeChoice('claude-cli', '', '')).toBe('');
    expect(describeChoice('codex-cli', 'gpt-x', 'medium')).toBe('gpt-x · Orta');
  });
});
