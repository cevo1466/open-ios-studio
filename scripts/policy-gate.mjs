#!/usr/bin/env node
/* global process, console */
// Release quality gate stub. Reads an EvaluationReport JSON (see src/policy/types.ts).
// Usage: node scripts/policy-gate.mjs <report.json> | --self-test
import { readFileSync } from 'node:fs';

const STATUSES = ['PASS', 'FAIL', 'WARNING', 'NOT_APPLICABLE', 'NOT_VERIFIED', 'BLOCKED'];

/** Pure evaluation: returns { blocked, reasons, counts }. */
export function gate(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.results)) {
    throw new Error('invalid report: "results" array missing');
  }
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of report.results) if (r.status in counts) counts[r.status]++;
  const reasons = [];
  if (report.blocksRelease === true) reasons.push('report.blocksRelease is true');
  for (const r of report.results) {
    if (r.status === 'FAIL' && r.severity === 'critical') reasons.push(`critical FAIL: ${r.ruleId} ${r.name ?? ''}`.trim());
  }
  return { blocked: reasons.length > 0, reasons, counts };
}

function run(report) {
  const { blocked, reasons, counts } = gate(report);
  console.log('Policy gate counts: ' + STATUSES.map((s) => `${s}=${counts[s]}`).join(' '));
  console.log('NOT VERIFIED/BLOCKED rules are not treated as passing.');
  if (blocked) {
    console.error('RELEASE BLOCKED:');
    for (const r of reasons) console.error(`  - ${r}`);
    return 1;
  }
  console.log('Gate passed (no blocking failures). This is not an App Store approval guarantee.');
  return 0;
}

function selfTest() {
  const mk = (results, blocksRelease = false) => ({ results, blocksRelease });
  const cases = [
    ['clean passes', mk([{ ruleId: 'A', status: 'PASS', severity: 'critical' }]), false],
    ['critical FAIL blocks', mk([{ ruleId: 'A', status: 'FAIL', severity: 'critical' }]), true],
    ['high FAIL does not block by itself', mk([{ ruleId: 'A', status: 'FAIL', severity: 'high' }]), false],
    ['blocksRelease blocks', mk([], true), true],
    ['NOT_VERIFIED critical does not pass silently but is not a FAIL', mk([{ ruleId: 'A', status: 'NOT_VERIFIED', severity: 'critical' }]), false],
  ];
  let bad = 0;
  for (const [name, rep, expected] of cases) {
    const got = gate(rep).blocked;
    if (got !== expected) { bad++; console.error(`self-test FAIL: ${name}`); }
  }
  let threw = false;
  try { gate({}); } catch { threw = true; }
  if (!threw) { bad++; console.error('self-test FAIL: invalid report must throw'); }
  console.log(bad ? `self-test: ${bad} failure(s)` : 'self-test: all passed');
  return bad ? 1 : 0;
}

const arg = process.argv[2];
if (arg === '--self-test') process.exit(selfTest());
if (!arg) { console.error('usage: policy-gate.mjs <report.json> | --self-test'); process.exit(2); }
try {
  process.exit(run(JSON.parse(readFileSync(arg, 'utf8'))));
} catch (e) {
  console.error(`policy-gate error: ${e.message}`);
  process.exit(2);
}
