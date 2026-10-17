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
  'budget-protocol': ['text-stream', 'read-tool', 'confirmed-write', 'rejected-write', 'reload-history', 'cancel', 'model-workflow', 'cpu-typical', 'cpu-max-input'],
  recovery: ['commit-before-dispatch', 'instance-ack-lost', 'early-confirmation', 'duplicate-confirmation', 'expired-confirmation', 'cancel-wins', 'success-wins', 'cancel-commit-race', 'lease-recovery', 'duplicate-scheduler', 'retry-budget', 'confirmation-timeout', 'usage-conservation'],
};

function fixture(t, { stripeWaiver = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'cfas-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'probes'), { recursive: true });
  mkdirSync(path.join(root, 'artifacts/gates'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(path.join(root, 'probes/versions.json'), '{"schemaVersion":1,"model":"test-model"}\n');
  writeFileSync(path.join(root, 'probes/worker.ts'), 'export const value = 1;\n');
  if (stripeWaiver) {
    mkdirSync(path.join(root, 'docs/validation'), { recursive: true });
    writeFileSync(path.join(root, 'docs/validation/approved-exceptions.json'), JSON.stringify({ schemaVersion: 1, exceptions: [{ id: 'stripe-sandbox-2026-10-17', gate: 'deployment', approvedBy: 'user', scope: ['stripe-sandbox-reuse', 'price-versioning'], reason: '暂时没有sandbox，可以跳过', paymentValidation: 'unverified' }] }));
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const reports = {};
  for (const [gate, ids] of Object.entries(cases)) {
    const evidencePath = `artifacts/gates/${gate}-evidence.json`;
    const evidence = JSON.stringify({ provider: 'cloudflare', requestId: `fixture-${gate}`, fixture: true, cloudIds: ids.map(id => `fixture-${id}`) });
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
      ...(gate === 'budget-protocol' ? { model: 'test-model', runId: 'fixture-run', samplesPerBoundary: 20, metrics: ['registration', 'login', 'session', 'webhook', 'model-stream', 'tool-loop', 'workflow-step'].map((name) => ({ name, limitMs: 30000, p95Ms: 50, maxMs: 50, sampleCounts: { typical: 20, maximum: 20, cold: 1 }, outcomes: ['ok'] })) } : {}),
    };
    if (gate === 'deployment') {
      const stripePath = 'artifacts/gates/stripe-evidence.json';
      const stripeData = '{"livemode":false,"fixture":true}';
      writeFileSync(path.join(root, stripePath), stripeData);
      reports[gate].evidence.push({ path: stripePath, sha256: hash(stripeData), source: 'stripe' });
    }
    if (gate === 'budget-protocol') {
      const report = reports[gate], samples = [], frames = [], requests = [];
      const add = (role, data, source = 'cloudflare') => {
        const file = `artifacts/gates/fixture-${role}.json`, raw = JSON.stringify(data);
        writeFileSync(path.join(root, file), raw);
        report.evidence.push({ path: file, sha256: hash(raw), source, role });
      };
      for (const metric of report.metrics) for (const [boundary,count] of Object.entries(metric.sampleCounts)) for (let i = 0; i < count; i++) {
        const invocation = `${metric.name}-${boundary}-${i}`;
        samples.push({ operation: metric.name, boundary, invocation, cpuTimeMs: 50, outcome: 'ok' });
        frames.push({ cpuTime: 50, outcome: 'ok', event: { request: { headers: { 'x-probe-invocation': invocation } } } });
        requests.push({ invocation, workerCommit: sourceCommit, status: 200 });
      }
      requests.push({ workerCommit: sourceCommit, path: '/workflows/fixture-model-workflow', response: { status: { status: 'complete' }, result: { model: 'test-model', text: 'fixture' } } });
      add('cpu-samples', samples); add('tail', frames); add('requests', requests);
      // Native Tail is a stream of JSON objects, not a JSON array.
      const tail = report.evidence.find(e => e.role === 'tail'), raw = frames.map(f => JSON.stringify(f)).join('\n');
      writeFileSync(path.join(root, tail.path), raw); tail.sha256 = hash(raw);
      const titles = ['streams text', 'renders a real read', 'asks for approval', 'denies a proposed', 'aborts the browser'];
      const ids = ['text-stream', 'read-tool', 'confirmed-write', 'rejected-write', 'cancel'];
      report.cases.find(c => c.id === 'reload-history').cloudIds = ['fixture-text-stream'];
      add('browser', { config: { metadata: { sourceCommit, runId: 'fixture-run', model: 'test-model' } }, suites: [{ specs: titles.map((title,i) => ({ title, tests: [{ annotations: [{ type: 'cloud-thread', description: `fixture-${ids[i]}` }], results: [{ status: 'passed' }] }] })) }] }, 'browser');
      add('threads', ids.map(id => ({ thread: { id: `fixture-${id}` } })));
    }
  }
  function recordMeasurement(gate) {
    const report = reports[gate], file = `artifacts/gates/${gate}-verdict.json`;
    const raw = JSON.stringify(Object.fromEntries(['gate','sourceCommit','environment','platformPlan','status','cases','blockers'].map(key => [key,report[key]])));
    writeFileSync(path.join(root,file),raw);
    report.evidence = report.evidence.filter(e => e.role !== 'assertion-verdict');
    report.evidence.push({ path:file,sha256:hash(raw),source:'probe',role:'assertion-verdict' });
  }
  Object.keys(reports).forEach(recordMeasurement);
  function save() { for (const [gate, report] of Object.entries(reports)) writeFileSync(path.join(root, `artifacts/gates/${gate}.json`), JSON.stringify(report)); }
  function run() { return spawnSync(process.execPath, [script, '--root', root, '--evidence-dir', 'artifacts/gates'], { encoding: 'utf8' }); }
  save();
  return { root, reports, save, run, recordMeasurement };
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

test('permits only the explicitly approved Stripe Sandbox exception and labels it unverified', (t) => {
  const f = fixture(t, { stripeWaiver: true });
  Object.assign(f.reports.deployment, { stripeMode: 'waived', stripeException: 'stripe-sandbox-2026-10-17', paymentValidation: 'unverified', stripeAccounts: [] });
  f.reports.deployment.evidence = f.reports.deployment.evidence.filter(x => x.source !== 'stripe');
  for (const entry of f.reports.deployment.cases.filter(x => ['stripe-sandbox-reuse', 'price-versioning'].includes(x.id))) { entry.status = 'waived'; entry.cloudIds = []; entry.actual = 'Not executed; explicitly waived by user'; }
  f.recordMeasurement('deployment');
  f.save();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Stripe Sandbox unverified/);
  f.reports.recovery.cases[0].status = 'waived'; f.save();
  assert.match(f.run().stderr, /recovery: case.*did not pass/);
});

test('rejects an unapproved Stripe waiver or a waived check reported as verified', (t) => {
  const f = fixture(t);
  Object.assign(f.reports.deployment, { stripeMode: 'waived', stripeException: 'stripe-sandbox-2026-10-17', paymentValidation: 'verified' }); f.save();
  assert.match(f.run().stderr, /Stripe exception.*not approved|Stripe exception.*unverified/);
});

test('rejects extra failed cases and a substituted model rather than ignoring them', t => {
  const f = fixture(t);
  f.reports['budget-protocol'].cases.push({ id: 'model-workflow', status: 'fail', expected: 'Real model', actual: 'Failed', cloudIds: ['fixture-model'] });
  f.reports['budget-protocol'].model = 'substituted-model'; f.save();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /model-workflow.*did not pass/);
  assert.match(result.stderr, /locked model/);
});

test('cannot turn opaque or failed evidence into a pass by editing report metrics', t => {
  const f = fixture(t); f.reports['budget-protocol'].evidence = f.reports['budget-protocol'].evidence.filter(e => !e.role); f.save();
  assert.equal(f.run().status, 1);
  assert.match(f.run().stderr, /structured CPU|browser evidence/);
});

test('recomputes CPU and browser outcomes from this run even if report remains pass', t => {
  const f = fixture(t), report = f.reports['budget-protocol'];
  const change = (role, mutate) => {
    const entry = report.evidence.find(e => e.role === role), raw = mutate(readFileSync(path.join(f.root, entry.path),'utf8'));
    writeFileSync(path.join(f.root, entry.path), raw); entry.sha256 = hash(raw);
  };
  change('tail', raw => raw.replace('"cpuTime":50', '"cpuTime":90000'));
  change('browser', raw => raw.replace('"status":"passed"', '"status":"failed"'));
  f.save(); const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CPU sample.*disagrees/);
  assert.match(result.stderr, /actual browser evidence did not pass/);
});

test('cannot hide a failed deployment or recovery measurement by changing only the report', t => {
  const f = fixture(t);
  for (const gate of ['deployment','recovery']) {
    const report = f.reports[gate], entry = report.evidence.find(e => e.role === 'assertion-verdict');
    const raw = JSON.stringify({ ...report, status: 'fail' });
    if (entry) { writeFileSync(path.join(f.root,entry.path),raw); entry.sha256 = hash(raw); }
  }
  f.save(); const result = f.run();
  assert.equal(result.status,1);
  assert.match(result.stderr,/deployment:.*measurement verdict/);
  assert.match(result.stderr,/recovery:.*measurement verdict/);
});
