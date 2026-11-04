/**
 * Orchestrates one pre-submission check. Everything that touches the outside world comes in
 * through `PreflightDeps`, so the flow is unit-tested with fakes and the app wires the real
 * Tauri commands in App.tsx.
 */
import type { EvaluationReport, ProjectFile, Rule } from '../policy/types';
import { fingerprintFiles } from './fingerprint';
import { checkIcon, iconHeaderString, type PngHeader } from './icon';
import { checkManifest, readXtoolConfig } from './manifest';
import { renderMarkdown } from './report';
import { buildStep, policyStep, secretsStep, testsStep, verdictOf, type RunOutcome } from './steps';
import { REPORT_JSON, REPORT_MD, type PreflightReport, type StepId, type StepResult } from './types';

export interface PreflightDeps {
  /** Workspace-relative project directory ('' = workspace root). */
  project: string;
  scan(): Promise<{ files: ProjectFile[]; truncated: boolean }>;
  runOp(op: 'build' | 'swift-test', args: { project?: string }, onLine: (text: string) => void): Promise<RunOutcome>;
  readPng(path: string): Promise<PngHeader | null>;
  writeFile(path: string, content: string): Promise<void>;
  analyze(files: ProjectFile[]): EvaluationReport;
  rules(): Rule[];
  now(): string;
}

export type ProgressListener = (id: StepId, state: 'running' | StepResult) => void;

const NO_TESTS = 'Projede Tests/ klasörü yok; swift test çalıştırılmadı.';

function inProject(path: string, project: string): string {
  return project ? `${project.replace(/\/+$/, '')}/${path}` : path;
}

export async function runPreflight(deps: PreflightDeps, onProgress: ProgressListener = () => {}): Promise<PreflightReport> {
  const startedAt = deps.now();
  const scan = await deps.scan();
  const prefix = deps.project ? `${deps.project.replace(/\/+$/, '')}/` : '';
  const projectFiles = prefix ? scan.files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ path: f.path.slice(prefix.length), content: f.content })) : scan.files;
  const cfg = readXtoolConfig(projectFiles);
  const header = await deps.readPng(inProject(cfg.iconPath, deps.project));
  const fingerprint = await fingerprintFiles(scan.files, iconHeaderString(header));

  const steps: StepResult[] = [];
  const run = async (id: StepId, fn: () => Promise<StepResult> | StepResult) => {
    onProgress(id, 'running');
    const result = await fn();
    steps.push(result);
    onProgress(id, result);
  };

  const args = deps.project ? { project: deps.project } : {};
  await run('build', () => deps.runOp('build', args, () => {}).then(buildStep));
  await run('tests', async () => {
    const hasTests = projectFiles.some((f) => f.path.startsWith('Tests/'));
    if (!hasTests) return testsStep({ skipped: NO_TESTS });
    return testsStep(await deps.runOp('swift-test', args, () => {}));
  });
  const policy = deps.analyze(projectFiles);
  await run('policy', () => {
    const r = policyStep(policy);
    if (scan.truncated) r.details.unshift('Tarama sınırına ulaşıldı: bazı dosyalar analiz edilmedi.');
    return r;
  });
  await run('secrets', () => secretsStep(policy, deps.rules()));
  await run('manifest', () => checkManifest(projectFiles));
  await run('icon', () => checkIcon(header, cfg.iconPath));

  const report: PreflightReport = { version: 1, startedAt, finishedAt: deps.now(), project: deps.project, fingerprint, steps, verdict: verdictOf(steps) };
  await deps.writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
  await deps.writeFile(REPORT_MD, renderMarkdown(report));
  return report;
}
