import type { ReleaseConfig } from './config';

export interface ReleasePaths {
  /** Where `xtool dev build --ipa` writes the release IPA (REQUIRES_RUNTIME_TEST: checked after the build). */
  built: string;
  repacked: string;
  signed: string;
}

const join = (...parts: string[]) => parts.filter((p) => p !== '').join('/');

export function releasePaths(c: ReleaseConfig): ReleasePaths {
  const stem = `${c.appName}-${c.shortVersion}-${c.buildNumber}`;
  return {
    built: join(c.project, 'xtool', `${c.appName}.ipa`),
    repacked: join('.studio', 'release', `${stem}-repacked.ipa`),
    signed: join('.studio', 'release', `${stem}-signed.ipa`),
  };
}
