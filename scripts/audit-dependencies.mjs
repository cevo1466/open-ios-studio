// Keep the high/critical gate; one unpatched, development-only advisory is
// assessed explicitly in docs/DEPENDENCY_AUDIT.md, with an automatic expiry.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const expires = '2026-12-01T00:00:00Z';
const isBlocking = (severity) => ['high', 'critical'].includes(severity);

export function assessAudit(report, lock, now = new Date()) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities) {
    throw new Error('Missing or unsupported npm audit report');
  }
  const blocked = [];
  const accepted = [];
  const knownDevelopmentFinding = (name, seen = new Set()) => {
    if (seen.has(name)) return false;
    const finding = report.vulnerabilities[name];
    if (!finding) return false;
    if (!isBlocking(finding.severity)) return true; // Original gate is high/critical.
    if (finding.severity === 'critical' || now >= new Date(expires)) return false;
    if (!finding.nodes?.length || !finding.nodes.every((node) => lock.packages?.[node]?.dev === true)) return false;
    if (!finding.via?.length) return false;
    const next = new Set([...seen, name]);
    return finding.via.every((via) => {
      if (typeof via === 'string') return knownDevelopmentFinding(via, next);
      if (!isBlocking(via.severity)) return true;
      return via.url === advisory && via.name === 'picomatch' && via.severity === 'high'
        && finding.nodes.every((node) => lock.packages[node].version === '4.0.7');
    });
  };
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (!isBlocking(finding.severity)) continue;
    (knownDevelopmentFinding(name) ? accepted : blocked).push(name);
  }
  return { blocked, accepted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Invoke npm's JS entrypoint without a shell (also works on Windows).
  if (!process.env.npm_execpath) throw new Error('Run through npm run audit:dependencies');
  const run = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || ![0, 1].includes(run.status)) throw new Error(`npm audit failed: ${run.error ?? run.stderr}`);
  const report = JSON.parse(run.stdout);
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const result = assessAudit(report, lock);
  console.log(JSON.stringify(report.metadata, null, 2));
  if (result.accepted.length) {
    console.warn(`WARNING: unpatched development-only ${advisory}; expires ${expires}; affected tools: ${result.accepted.join(', ')}. See docs/DEPENDENCY_AUDIT.md.`);
  }
  if (result.blocked.length) {
    console.error(`Blocked high/critical dependencies: ${result.blocked.join(', ')}`);
    process.exitCode = 1;
  }
}
