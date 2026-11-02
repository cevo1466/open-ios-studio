import { describe, expect, it } from 'vitest';
import { buildSteps, nextStep, type StepInput } from './steps';

const base: StepInput = { desktop: true, hasWorkspace: true, xtoolFound: true, configValid: true, ascConfigured: false, done: {}, running: null, failed: null };
const state = (i: Partial<StepInput>) => Object.fromEntries(buildSteps({ ...base, ...i }).map((s) => [s.id, s.state]));

describe('release steps', () => {
  it('without an Apple account only local steps can run', () => {
    const s = state({});
    expect(s).toMatchObject({ settings: 'done', credentials: 'ready', build: 'ready', repack: 'blocked', prepare: 'blocked', sign: 'blocked', upload: 'blocked' });
    const why = buildSteps(base).find((x) => x.id === 'prepare')?.why;
    expect(why).toContain('anahtar');
  });

  it('follows the order build -> repack -> prepare -> sign -> upload', () => {
    const done = { build: true, repack: true, prepare: true } as const;
    const s = state({ ascConfigured: true, done });
    expect(s).toMatchObject({ build: 'done', repack: 'done', prepare: 'done', sign: 'ready', upload: 'blocked' });
    expect(nextStep(buildSteps({ ...base, ascConfigured: true, done }))?.id).toBe('sign');
  });

  it('blocks everything else while one step runs and flags failures', () => {
    const s = state({ running: 'build', ascConfigured: true });
    expect(s.build).toBe('running');
    expect(s.credentials).toBe('blocked');
    expect(state({ failed: 'build' }).build).toBe('failed');
  });

  it('is blocked outside the desktop app, without xtool and with an invalid config', () => {
    expect(state({ desktop: false }).build).toBe('blocked');
    expect(state({ xtoolFound: false }).build).toBe('blocked');
    const s = state({ configValid: false, ascConfigured: true });
    expect(s).toMatchObject({ settings: 'ready', build: 'blocked', prepare: 'blocked' });
  });

  it('marks exactly the Apple-dependent steps', () => {
    const apple = buildSteps(base).filter((s) => s.needsApple).map((s) => s.id);
    expect(apple).toEqual(['credentials', 'prepare', 'sign', 'upload']);
  });

  it('reports nothing left to do when everything is done', () => {
    const done = { build: true, repack: true, prepare: true, sign: true, upload: true } as const;
    expect(nextStep(buildSteps({ ...base, ascConfigured: true, done }))).toBeNull();
  });
});
