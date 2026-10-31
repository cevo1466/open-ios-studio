#!/usr/bin/env node
/* global process, console */
// Dependency-free validator for policies/*.rules.json (semantics of policies/schema/rule.schema.json).
// Usage: node scripts/validate-policies.mjs [--dir <path>]   (default: policies)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAPABILITY_KEYS = new Set([
  'targetsAppStore', 'hasUserAccounts', 'hasSocialLogin', 'hasSignInWithApple',
  'hasSubscriptions', 'hasInAppPurchases', 'usesFirebase', 'hasBackend', 'usesExternalApis',
  'processesPersonalData', 'usesCamera', 'usesMicrophone', 'usesLocation', 'usesPhotos',
  'usesTracking', 'usesWebView', 'usesAI', 'hasAuthTokens', 'hasDeepLinks',
  'hasExternalPaymentLinks', 'hasOtpFlow', 'hasPasswordReset', 'hasAdminRoles',
  'hasUserControlledUrlFetch', 'hasCiWorkflows',
]);
const IMPLEMENTATIONS = ['ENFORCED', 'PARTIAL', 'MANUAL_ONLY', 'NOT_IMPLEMENTED'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const PLATFORMS = ['ios', 'android', 'backend', 'repo', 'ai-agent'];
const AUTOFIX = ['none', 'safe', 'needs-approval'];
const RULE_KEYS = [
  'id', 'name', 'category', 'platform', 'applicability', 'notApplicableReason', 'severity',
  'officialReference', 'detectionMethod', 'remediation', 'autoFix', 'requiresApproval',
  'verification', 'evidence', 'implementation', 'detectorId', 'lastVerified', 'policyVersion',
];
const CATALOGS = [
  { file: 'app-store.rules.json', catalog: 'app-store', prefix: 'ASR', count: 24 },
  { file: 'mobile-security.rules.json', catalog: 'mobile-security', prefix: 'MSEC', count: 26 },
];

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkApplicability(a, err) {
  if (!isObj(a)) return err('applicability must be an object');
  if ('always' in a) {
    if (a.always !== true || Object.keys(a).length !== 1) err('applicability {always} must be exactly {"always": true}');
    return;
  }
  const keys = Object.keys(a);
  if (keys.length === 0) err('applicability must not be empty');
  for (const k of keys) {
    if (!['all', 'any', 'none'].includes(k)) { err(`applicability: unknown key "${k}"`); continue; }
    if (!Array.isArray(a[k])) { err(`applicability.${k} must be an array`); continue; }
    if (new Set(a[k]).size !== a[k].length) err(`applicability.${k} has duplicates`);
    for (const c of a[k]) if (!CAPABILITY_KEYS.has(c)) err(`applicability.${k}: invalid capability "${c}"`);
  }
}

export function validateCatalog(data, spec) {
  const errors = [];
  const top = (m) => errors.push(`${spec.file}: ${m}`);
  const counts = Object.fromEntries(IMPLEMENTATIONS.map((i) => [i, 0]));
  if (!isObj(data)) { top('root must be an object'); return { errors, counts, total: 0 }; }
  for (const k of ['catalog', 'policyVersion', 'rules']) if (!(k in data)) top(`missing key "${k}"`);
  for (const k of Object.keys(data)) if (!['catalog', 'policyVersion', 'rules'].includes(k)) top(`unknown key "${k}"`);
  if (data.catalog !== spec.catalog) top(`catalog must be "${spec.catalog}"`);
  if (!isStr(data.policyVersion)) top('policyVersion must be a non-empty string');
  if (!Array.isArray(data.rules)) { top('rules must be an array'); return { errors, counts, total: 0 }; }

  if (data.rules.length !== spec.count) top(`expected exactly ${spec.count} rules, found ${data.rules.length}`);
  const expected = Array.from({ length: spec.count }, (_, i) => `${spec.prefix}-${String(i + 1).padStart(3, '0')}`);
  const seen = new Set();
  data.rules.forEach((r, idx) => {
    const where = isObj(r) && isStr(r.id) ? r.id : `rules[${idx}]`;
    const err = (m) => errors.push(`${spec.file} ${where}: ${m}`);
    if (!isObj(r)) return err('rule must be an object');
    for (const k of RULE_KEYS) if (!(k in r)) err(`missing key "${k}"`);
    for (const k of Object.keys(r)) if (!RULE_KEYS.includes(k)) err(`unknown key "${k}"`);
    if (!/^(ASR|MSEC)-\d{3}$/.test(r.id ?? '')) err('id must match ^(ASR|MSEC)-\\d{3}$');
    else if (!r.id.startsWith(`${spec.prefix}-`)) err(`id must start with ${spec.prefix}-`);
    if (seen.has(r.id)) err('duplicate id');
    seen.add(r.id);
    for (const k of ['name', 'category', 'policyVersion']) if (!isStr(r[k])) err(`${k} must be a non-empty string`);
    for (const k of ['notApplicableReason', 'detectionMethod', 'remediation', 'verification', 'evidence']) {
      if (typeof r[k] !== 'string') err(`${k} must be a string`);
    }
    if (!Array.isArray(r.platform) || r.platform.length === 0) err('platform must be a non-empty array');
    else for (const p of r.platform) if (!PLATFORMS.includes(p)) err(`invalid platform "${p}"`);
    if (!SEVERITIES.includes(r.severity)) err(`invalid severity "${r.severity}"`);
    if (!AUTOFIX.includes(r.autoFix)) err(`invalid autoFix "${r.autoFix}"`);
    if (typeof r.requiresApproval !== 'boolean') err('requiresApproval must be boolean');
    if (!isObj(r.officialReference) || !isStr(r.officialReference.title) || !isStr(r.officialReference.url)) {
      err('officialReference must have non-empty title and url');
    }
    checkApplicability(r.applicability, err);

    if (!IMPLEMENTATIONS.includes(r.implementation)) err(`invalid implementation "${r.implementation}"`);
    else {
      counts[r.implementation]++;
      const manual = r.implementation === 'MANUAL_ONLY' || r.implementation === 'NOT_IMPLEMENTED';
      if (manual && r.detectorId !== null) err(`detectorId must be null when implementation is ${r.implementation}`);
      if (!manual && r.detectorId !== r.id) err(`detectorId must equal rule id when implementation is ${r.implementation}`);
      if (!manual && r.lastVerified !== null && !(typeof r.lastVerified === 'string')) err('lastVerified must be null or a date string');
    }
    if (r.lastVerified !== null && !(typeof r.lastVerified === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastVerified) && !Number.isNaN(Date.parse(r.lastVerified)))) {
      err('lastVerified must be null or a YYYY-MM-DD date string');
    }
  });
  for (const id of expected) if (!seen.has(id)) top(`missing rule ${id}`);
  return { errors, counts, total: data.rules.length };
}

function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dir');
  const dir = di >= 0 && args[di + 1] ? args[di + 1] : 'policies';
  const allErrors = [];
  const rows = [];
  for (const spec of CATALOGS) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, spec.file), 'utf8'));
    } catch (e) {
      allErrors.push(`${spec.file}: cannot read/parse (${e.message})`);
      continue;
    }
    const res = validateCatalog(data, spec);
    allErrors.push(...res.errors);
    rows.push({ catalog: spec.catalog, total: res.total, ...res.counts });
  }
  if (rows.length) {
    const cols = ['catalog', 'total', ...IMPLEMENTATIONS];
    const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
    const fmt = (vals) => vals.map((v, i) => String(v).padEnd(w[i])).join('  ');
    console.log(fmt(cols));
    console.log(w.map((n) => '-'.repeat(n)).join('  '));
    for (const r of rows) console.log(fmt(cols.map((c) => r[c])));
  }
  if (allErrors.length) {
    console.error(`\n${allErrors.length} violation(s):`);
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nOK: policy catalogs valid.');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
