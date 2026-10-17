import { readFileSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parseTailFrames, summarizeCpu } from '../probes/shared/cloud.mjs';

const requiredCases = {
  deployment: ['resource-reuse', 'environment-isolation', 'session-continuity', 'migration-once', 'stripe-sandbox-reuse', 'lost-response-recovery', 'unknown-signing-secret-not-ready', 'price-versioning'],
  'budget-protocol': ['text-stream', 'read-tool', 'confirmed-write', 'rejected-write', 'reload-history', 'cancel', 'model-workflow', 'cpu-typical', 'cpu-max-input'],
  recovery: ['commit-before-dispatch', 'instance-ack-lost', 'early-confirmation', 'duplicate-confirmation', 'expired-confirmation', 'cancel-wins', 'success-wins', 'cancel-commit-race', 'lease-recovery', 'duplicate-scheduler', 'retry-budget', 'confirmation-timeout', 'usage-conservation'],
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const probePaths = ['probes', 'scripts', 'package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json', 'docs/validation/approved-exceptions.json'];

export function verifyReports(root, directory) {
  root = realpathSync(root);
  const errors = [];
  const warnings = [];
  const targets = new Set();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const fail = (gate, reason) => errors.push(`${gate}: ${reason}`);
  for (const [gate, ids] of Object.entries(requiredCases)) {
    const file = path.resolve(root, directory, `${gate}.json`);
    if (!existsSync(file)) { fail(gate, 'report missing'); continue; }
    let report;
    try { report = JSON.parse(readFileSync(file, 'utf8')); }
    catch { fail(gate, 'invalid report JSON'); continue; }
    if (!report || typeof report !== 'object' || Array.isArray(report)) { fail(gate, 'invalid report object'); continue; }
    const waivedCases = new Set();
    if (gate === 'deployment' && report.stripeMode === 'waived') {
      let approved;
      try { approved = JSON.parse(readFileSync(path.join(root, 'docs/validation/approved-exceptions.json'), 'utf8')).exceptions.find(x => x.id === 'stripe-sandbox-2026-10-17'); } catch { /* checked below */ }
      if (report.stripeException !== 'stripe-sandbox-2026-10-17' || approved?.gate !== 'deployment' || approved?.approvedBy !== 'user' || JSON.stringify(approved?.scope) !== JSON.stringify(['stripe-sandbox-reuse', 'price-versioning'])) fail(gate, 'Stripe exception is not approved');
      else if (report.paymentValidation !== 'unverified' || approved.paymentValidation !== 'unverified') fail(gate, 'Stripe exception must remain unverified');
      else { approved.scope.forEach(id => waivedCases.add(id)); warnings.push('Stripe Sandbox unverified: user-approved exception stripe-sandbox-2026-10-17'); }
    }
    if (report?.schemaVersion !== 1 || report.gate !== gate) fail(gate, 'report schema mismatch');
    if (report?.status !== 'pass') fail(gate, `status ${String(report?.status)} is not pass`);
    if (report?.blockers?.length) fail(gate, 'unresolved blockers');
    if (report?.mode !== 'cloud') fail(gate, 'cloud execution required');
    if (!['free', 'paid'].includes(report?.platformPlan)) fail(gate, 'actual platform plan required');
    if (!/^cfas-probe-[a-z0-9-]+$/.test(report?.environment ?? '')) fail(gate, 'disposable probe environment required');
    targets.add(`${report.platformPlan}:${report.environment?.replace(/-(dev|prod)$/, '')}`);
    const timestamp = Date.parse(report?.executedAt);
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000) fail(gate, 'invalid execution timestamp');
    if (report?.cleanWorkingTree !== true) fail(gate, 'source was not clean when measured');
    try {
      if (!/^[a-f0-9]{40}$/.test(report?.sourceCommit ?? '')) throw new Error('invalid commit');
      git('cat-file', '-e', `${report.sourceCommit}^{commit}`);
      if (git('diff', '--name-only', report.sourceCommit, '--', ...probePaths)) fail(gate, 'probe source changed since evidence');
      if (git('status', '--porcelain', '--untracked-files=all', '--', ...probePaths)) fail(gate, 'uncommitted probe code');
    } catch { fail(gate, 'source commit cannot be verified'); }
    for (const [name, key] of [['package-lock.json', 'lockfileSha256'], ['probes/versions.json', 'versionsSha256']]) {
      try { if (hash(readFileSync(path.join(root, name))) !== report?.[key]) fail(gate, `${key === 'lockfileSha256' ? 'lockfile' : 'versions'} checksum mismatch`); }
      catch { fail(gate, `${name} missing`); }
    }
    const found = Array.isArray(report?.cases) ? report.cases : [];
    for (const entry of found) if (entry.status !== 'pass' && !waivedCases.has(entry.id)) fail(gate, `case ${entry.id} did not pass`);
    for (const id of ids) {
      const matching = found.filter((entry) => entry.id === id);
      if (matching.length !== 1) { fail(gate, `missing case ${id} or duplicate case`); continue; }
      const entry = matching[0];
      if (waivedCases.has(id)) {
        if (entry.status !== 'waived' || !entry.expected || !entry.actual || entry.cloudIds?.length) fail(gate, `case ${id} must be explicitly waived without cloud claims`);
        continue;
      }
      if (entry.status !== 'pass') fail(gate, `case ${id} did not pass`);
      if (!entry.expected || !entry.actual) fail(gate, `case ${id} has no assertions`);
      if (!Array.isArray(entry.cloudIds) || !entry.cloudIds.some((value) => typeof value === 'string' && value.length > 0)) fail(gate, `case ${id} has no cloud identifier`);
    }
    if (!Array.isArray(report?.evidence) || report.evidence.length === 0) fail(gate, 'raw evidence missing');
    const evidenceEntries = Array.isArray(report.evidence) ? report.evidence : [];
    const verified = [];
    if (!evidenceEntries.some((entry) => entry.source === 'cloudflare')) fail(gate, 'Cloudflare evidence required');
    for (const entry of evidenceEntries) {
      if (typeof entry?.path !== 'string') { fail(gate, 'unsafe evidence path'); continue; }
      const evidencePath = path.resolve(root, entry.path);
      if (!evidencePath.startsWith(root + path.sep)) { fail(gate, 'unsafe evidence path'); continue; }
      try {
        if (!realpathSync(evidencePath).startsWith(root + path.sep)) { fail(gate, 'unsafe evidence path'); continue; }
        const raw = readFileSync(evidencePath, 'utf8');
        if (hash(raw) !== entry.sha256) fail(gate, 'evidence checksum mismatch');
        else verified.push({ ...entry, raw });
      } catch { fail(gate, 'raw evidence file missing'); }
    }
    const observedIds = new Set();
    const collect = v => { if (typeof v === 'string') observedIds.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
    for (const entry of verified) { try { collect(JSON.parse(entry.raw)); } catch { collect(parseTailFrames(entry.raw)); } }
    for (const entry of found) if (entry.status === 'pass' && !entry.cloudIds?.some(id => observedIds.has(id))) fail(gate, `case ${entry.id} identifiers absent from actual evidence`);
    if (gate === 'deployment' && report.stripeMode !== 'waived') {
      if (report.stripeMode !== 'sandbox' || !Array.isArray(report.stripeAccounts) || report.stripeAccounts.length !== 2 || new Set(report.stripeAccounts).size !== 2) fail(gate, 'two isolated Stripe Sandboxes required');
      if (!evidenceEntries.some((entry) => entry.source === 'stripe')) fail(gate, 'Stripe evidence required');
    }
    if (gate === 'budget-protocol') {
      if (typeof report.model !== 'string' || report.model.length === 0) fail(gate, 'real model ID required');
      try { if (report.model !== JSON.parse(readFileSync(path.join(root, 'probes/versions.json'), 'utf8')).model) fail(gate, 'locked model does not match'); } catch { fail(gate, 'locked model missing'); }
      verifyBudgetEvidence(report, verified, reason => fail(gate, reason));
      if (!Number.isInteger(report.samplesPerBoundary) || report.samplesPerBoundary < 20) fail(gate, 'at least 20 samples per input boundary required');
      if (!Array.isArray(report.metrics) || report.metrics.length === 0) fail(gate, 'CPU measurements missing');
      const metrics = Array.isArray(report.metrics) ? report.metrics : [];
      for (const name of ['registration', 'login', 'session', 'webhook', 'model-stream', 'tool-loop', 'workflow-step']) {
        if (metrics.filter((entry) => entry.name === name).length !== 1) fail(gate, `CPU operation ${name} missing or duplicated`);
      }
      for (const metric of metrics) {
        const maxLimit = report.platformPlan === 'free' ? 10 : 300000;
        if (![metric.limitMs, metric.p95Ms, metric.maxMs].every(Number.isFinite) || !(metric.limitMs > 0 && metric.limitMs <= maxLimit && metric.p95Ms >= 0 && metric.maxMs >= metric.p95Ms && metric.p95Ms <= metric.limitMs * 0.8 && metric.maxMs <= metric.limitMs)) fail(gate, 'CPU safety margin exceeded or invalid metrics');
        if (!(Number.isInteger(metric.sampleCounts?.typical) && metric.sampleCounts.typical >= 20 && Number.isInteger(metric.sampleCounts?.maximum) && metric.sampleCounts.maximum >= 20 && metric.sampleCounts?.cold >= 1)) fail(gate, `${metric.name}: 20 samples per boundary and cold request required`);
        if (!Array.isArray(metric.outcomes) || metric.outcomes.length === 0 || metric.outcomes.some((outcome) => outcome !== 'ok')) fail(gate, 'non-success cloud invocation outcome');
      }
    }
  }
  if (targets.size > 1) errors.push('gates: platform plan or disposable target differs across reports');
  return { ok: errors.length === 0, errors, warnings };
}

function verifyBudgetEvidence(report, evidence, fail) {
  const read = role => {
    const entries = evidence.filter(x => x.role === role);
    if (entries.length !== 1) return null;
    try { return JSON.parse(entries[0].raw); } catch { return null; }
  };
  const samples = read('cpu-samples'), requests = read('requests');
  const tail = evidence.filter(x => x.role === 'tail');
  if (!Array.isArray(samples) || !Array.isArray(requests) || tail.length !== 1) fail('structured CPU evidence missing');
  else {
    const frames = parseTailFrames(tail[0].raw), seen = new Set();
    for (const sample of samples) {
      const matches = frames.filter(x => x.event?.request?.headers?.['x-probe-invocation'] === sample.invocation);
      const journal = requests.find(x => x.invocation === sample.invocation);
      if (seen.has(sample.invocation) || matches.length !== 1 || journal?.workerCommit !== report.sourceCommit || journal.status !== 200 || matches[0]?.cpuTime !== sample.cpuTimeMs || matches[0]?.outcome !== 'ok') fail('CPU sample is missing, duplicated or disagrees with its actual invocation');
      seen.add(sample.invocation);
    }
    for (const metric of report.metrics ?? []) {
      const measured = samples.filter(x => x.operation === metric.name);
      try {
        const stats = summarizeCpu(measured.map(x => ({ cpuTime: x.cpuTimeMs, outcome: x.outcome })));
        const counts = Object.fromEntries(['typical','maximum','cold'].map(b => [b, measured.filter(x => x.boundary === b).length]));
        if (stats.p95Ms !== metric.p95Ms || stats.maxMs !== metric.maxMs || JSON.stringify(counts) !== JSON.stringify(metric.sampleCounts) || JSON.stringify(stats.outcomes) !== JSON.stringify(metric.outcomes)) fail(`${metric.name}: metrics disagree with structured CPU evidence`);
      } catch { fail(`${metric.name}: structured CPU evidence missing`); }
    }
  }
  const browser = read('browser'), threads = read('threads');
  if (!browser || browser.config?.metadata?.sourceCommit !== report.sourceCommit || browser.config?.metadata?.runId !== report.runId || !report.runId || browser.config?.metadata?.model !== report.model || !Array.isArray(threads)) { fail('fresh browser evidence missing or source/run/model differs'); return; }
  const specs = [];
  const visit = s => { specs.push(...(s.specs ?? [])); for (const child of s.suites ?? []) visit(child); };
  visit(browser);
  for (const [id, prefix] of [['text-stream','streams text'],['reload-history','streams text'],['read-tool','renders a real read'],['confirmed-write','asks for approval'],['rejected-write','denies a proposed'],['cancel','aborts the browser']]) {
    const tests = specs.find(s => s.title.startsWith(prefix))?.tests ?? [];
    const entry = report.cases?.find(c => c.id === id);
    const ids = tests.flatMap(t => (t.annotations ?? []).filter(a => a.type === 'cloud-thread').map(a => a.description));
    if (tests.length !== 1 || tests[0].results?.length !== 1 || tests[0].results[0].status !== 'passed' || !ids.length || !ids.every(id => entry?.cloudIds?.includes(id) && threads.some(t => t.thread?.id === id))) fail(`${id}: actual browser evidence did not pass or thread IDs differ`);
  }
  const workflow = report.cases?.find(c => c.id === 'model-workflow');
  if (!requests?.some(r => r.workerCommit === report.sourceCommit && workflow?.cloudIds?.some(id => r.path?.endsWith('/' + id)) && r.response?.status?.status === 'complete' && r.response?.result?.model === report.model && r.response.result.text?.length > 0)) fail('model-workflow: real result evidence missing');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { root: { type: 'string', default: process.cwd() }, 'evidence-dir': { type: 'string', default: 'artifacts/gates' } } });
  const result = verifyReports(values.root, values['evidence-dir']);
  if (result.ok) console.log(result.warnings.length ? `3/3 gate requirements met with approved exceptions. ${result.warnings.join('; ')}. Phase two may start.` : '3/3 gates passed. Phase two may start.');
  else { for (const error of result.errors) console.error(error); process.exitCode = 1; }
}
