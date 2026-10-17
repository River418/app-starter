import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = fileURLToPath(new URL('../../scripts/verify-gate.mjs', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cases = {
  deployment: ['resource-reuse', 'environment-isolation', 'session-continuity', 'migration-once', 'stripe-sandbox-reuse', 'lost-response-recovery', 'unknown-signing-secret-not-ready', 'price-versioning'],
  'budget-protocol': ['text-stream', 'read-tool', 'confirmed-write', 'rejected-write', 'reload-history', 'cancel', 'cpu-typical', 'cpu-max-input'],
  recovery: ['commit-before-dispatch', 'instance-ack-lost', 'early-confirmation', 'duplicate-confirmation', 'expired-confirmation', 'cancel-wins', 'success-wins', 'cancel-commit-race', 'lease-recovery', 'duplicate-scheduler', 'retry-budget', 'confirmation-timeout', 'usage-conservation'],
};

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'cfas-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'probes'), { recursive: true });
  mkdirSync(path.join(root, 'artifacts/gates'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(path.join(root, 'probes/versions.json'), '{"schemaVersion":1,"model":"test-model"}\n');
  writeFileSync(path.join(root, 'probes/worker.ts'), 'export const value = 1;\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const reports = {};
  for (const [gate, ids] of Object.entries(cases)) {
    const evidencePath = `artifacts/gates/${gate}-evidence.json`;
    const evidence = JSON.stringify({ provider: 'cloudflare', requestId: `fixture-${gate}`, fixture: true });
    writeFileSync(path.join(root, evidencePath), evidence);
    reports[gate] = {
      schemaVersion: 1, gate, status: 'pass', sourceCommit, cleanWorkingTree: true,
      lockfileSha256: hash(readFileSync(path.join(root, 'package-lock.json'))),
      versionsSha256: hash(readFileSync(path.join(root, 'probes/versions.json'))),
      environment: 'cfas-probe-fixture-dev', platformPlan: 'paid', mode: 'cloud',
      executedAt: new Date().toISOString(),
      cases: ids.map((id) => ({ id, status: 'pass', expected: 'contract holds', actual: 'contract holds', cloudIds: [`fixture-${id}`] })),
      evidence: [{ path: evidencePath, sha256: hash(evidence), source: 'cloudflare' }],
      ...(gate === 'deployment' ? { stripeMode: 'sandbox', stripeAccounts: ['fixture-a', 'fixture-b'] } : {}),
      ...(gate === 'budget-protocol' ? { model: 'test-model', samplesPerBoundary: 20, metrics: ['registration', 'login', 'session', 'webhook', 'model-stream', 'tool-loop', 'workflow-step'].map((name) => ({ name, limitMs: 30000, p95Ms: 50, maxMs: 70, sampleCounts: { typical: 20, maximum: 20, cold: 1 }, outcomes: ['ok'] })) } : {}),
    };
    if (gate === 'deployment') {
      const stripePath = 'artifacts/gates/stripe-evidence.json';
      const stripeData = '{"livemode":false,"fixture":true}';
      writeFileSync(path.join(root, stripePath), stripeData);
      reports[gate].evidence.push({ path: stripePath, sha256: hash(stripeData), source: 'stripe' });
    }
  }
  function save() { for (const [gate, report] of Object.entries(reports)) writeFileSync(path.join(root, `artifacts/gates/${gate}.json`), JSON.stringify(report)); }
  function run() { return spawnSync(process.execPath, [script, '--root', root, '--evidence-dir', 'artifacts/gates'], { encoding: 'utf8' }); }
  save();
  return { root, reports, save, run };
}

test('accepts three complete cloud reports tied to unchanged committed probe code', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3\/3 gates passed/);
});

for (const status of ['not_run', 'blocked', 'fail', 'skipped']) {
  test(`rejects ${status} rather than treating unavailable verification as success`, (t) => {
    const f = fixture(t); f.reports.deployment.status = status; f.save();
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /deployment: status/);
  });
}

test('rejects missing required recovery case even when every listed case passes', (t) => {
  const f = fixture(t); f.reports.recovery.cases.pop(); f.save();
  assert.match(f.run().stderr, /recovery: missing case usage-conservation/);
});

test('rejects local runs and missing cloud invocation identifiers', (t) => {
  const f = fixture(t); f.reports.deployment.mode = 'local'; f.reports.recovery.cases[0].cloudIds = []; f.save();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployment: cloud execution required/);
  assert.match(result.stderr, /recovery:.*cloud identifier/);
});

test('rejects absent or altered raw evidence', (t) => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'artifacts/gates/deployment-evidence.json'), '{}');
  assert.match(f.run().stderr, /deployment: evidence checksum/);
});

test('rejects evidence paths escaping the repository', (t) => {
  const f = fixture(t); f.reports.deployment.evidence[0].path = '../private.json'; f.save();
  assert.match(f.run().stderr, /deployment: unsafe evidence path/);
});

test('rejects stale lockfile and uncommitted or newly added probe source', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'package-lock.json'), '{}');
  writeFileSync(path.join(f.root, 'probes/new-source.ts'), 'export const changed = true;');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lockfile checksum/);
  assert.match(result.stderr, /uncommitted probe code/);
});

test('rejects changed probe code even if the change was committed after the report', (t) => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'probes/worker.ts'), 'export const value = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: f.root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'changed source'], { cwd: f.root });
  assert.match(f.run().stderr, /probe source changed since evidence/);
});

test('rejects absent real-model budget samples or CPU outside safety margin', (t) => {
  const f = fixture(t); f.reports['budget-protocol'].samplesPerBoundary = 2; f.reports['budget-protocol'].metrics[0].p95Ms = 29000; f.save();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /20 samples/);
  assert.match(result.stderr, /CPU safety margin/);
});

test('rejects testing two names backed by the same Stripe Sandbox', (t) => {
  const f = fixture(t); f.reports.deployment.stripeAccounts = ['same', 'same']; f.save();
  assert.match(f.run().stderr, /two isolated Stripe Sandboxes/);
});

test('rejects CPU evidence missing an operation or enough samples for each operation', (t) => {
  const f = fixture(t); f.reports['budget-protocol'].metrics.pop();
  f.reports['budget-protocol'].metrics[0].sampleCounts.maximum = 1; f.save();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /workflow-step.*missing/);
  assert.match(result.stderr, /registration.*20 samples/);
});

test('rejects a Sandbox claim without Stripe-sourced evidence', (t) => {
  const f = fixture(t); f.reports.deployment.evidence = f.reports.deployment.evidence.filter((entry) => entry.source !== 'stripe'); f.save();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stripe evidence required/);
});

test('rejects missing report without accepting other gates as completion', (t) => {
  const f = fixture(t); rmSync(path.join(f.root, 'artifacts/gates/deployment.json'));
  assert.match(f.run().stderr, /deployment: report missing/);
});
