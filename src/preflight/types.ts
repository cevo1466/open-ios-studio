/**
 * Pre-submission check ("Yayın öncesi denetim"): one run that builds, tests, analyses and checks
 * the open project. The verdict is bound to a fingerprint of the project files, so any later
 * change makes the report stale. See docs/superpowers/specs/2026-11-03-launch-readiness-2-design.md.
 */

export type StepId = 'build' | 'tests' | 'policy' | 'secrets' | 'manifest' | 'icon';

/** Same vocabulary as the policy rules (CLAUDE.md). A step is PASS only when its check ran. */
export type StepStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_VERIFIED' | 'BLOCKED';

export interface StepResult {
  id: StepId;
  status: StepStatus;
  /** One line for the list and the sidebar. */
  summary: string;
  /** Diagnostics, rule ids, log excerpts; shown expanded on demand. */
  details: string[];
}

export type Verdict = 'green' | 'red';

export interface PreflightReport {
  version: 1;
  startedAt: string;
  finishedAt: string;
  /** Workspace-relative project directory ('' for the workspace root). */
  project: string;
  /** SHA-256 over the scanned files and the icon header; see fingerprint.ts. */
  fingerprint: string;
  steps: StepResult[];
  verdict: Verdict;
}

export const STEP_ORDER: StepId[] = ['build', 'tests', 'policy', 'secrets', 'manifest', 'icon'];

export const STEP_NAME: Record<StepId, string> = {
  build: 'Derleme',
  tests: 'Testler',
  policy: 'Politika',
  secrets: 'Gizli anahtarlar',
  manifest: 'Manifest',
  icon: 'Simge',
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  PASS: 'Geçti',
  FAIL: 'Başarısız',
  WARNING: 'Uyarı',
  NOT_VERIFIED: 'Doğrulanamadı',
  BLOCKED: 'Engellendi',
};

/** Report files inside the workspace. The directory is excluded from the fingerprint. */
export const REPORT_DIR = '.open-ios-studio/preflight';
export const REPORT_JSON = `${REPORT_DIR}/latest.json`;
export const REPORT_MD = `${REPORT_DIR}/latest.md`;

export const HONESTY_LINE =
  'Yeşil, bu bilgisayarda derleme, testler ve kaynak düzeyi kontroller geçti demektir; App Store onayı anlamına gelmez.';
