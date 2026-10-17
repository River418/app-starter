import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deployProbe, reconcileDatabase, wrangler } from './deploy.mjs';
import { openProbe, root, sha256 } from '../shared/cloud.mjs';

export async function runDeploymentProbe({ account, subdomain }) {
  const dev = await openProbe('dev', 'deployment'), prod = await openProbe('prod', 'deployment');
  const evidenceDir = dev.evidenceDir, cases = [], suffix = Date.now(), configPath = resolve(root, 'probes/deployment/wrangler.jsonc');
  const native = args => wrangler(args, { account, evidenceDir });
  async function snapshot() {
    const databases = JSON.parse(await native(['d1','list','--json']));
    const workflows = JSON.parse(await native(['workflows','list','--json']));
    const buckets = await native(['r2','bucket','list']);
    const bindings = [];
    for (const probe of [dev, prod]) {
      const target = probe.target;
      assert.equal(reconcileDatabase(target.d1_databases[0], databases), target.d1_databases[0].database_id);
      assert.ok([...buckets.matchAll(/^name:\s+([^\s]+)\s*$/gm)].some(x => x[1] === target.name));
      const workflowRows = Array.isArray(workflows) ? workflows : workflows.workflows;
      const selected = target.workflows.map(binding => {
        const workflow = workflowRows.find(x => x.name === binding.name);
        assert.ok(workflow, `Missing Workflow ${binding.name}`);
        return { binding: binding.binding, name: workflow.name, id: workflow.id };
      });
      bindings.push({ environment: probe.environment, database: target.d1_databases[0], bucket: target.r2_buckets[0], workflows: selected });
    }
    assert.notEqual(bindings[0].database.database_id, bindings[1].database.database_id);
    assert.notEqual(bindings[0].bucket.bucket_name, bindings[1].bucket.bucket_name);
    return { bindings, databases };
  }
  async function migrations(environment) {
    const value = JSON.parse(await native(['d1','execute','DB','--config',configPath,'--env',environment,'--remote','--command','SELECT name, applied_at FROM d1_migrations ORDER BY id','--json']));
    return value[0].results;
  }
  const fixtures = [];
  const captures = [];
  let failure;
  try {
    const initial = await snapshot(); captures.push(initial);
    for (const probe of [dev, prod]) {
      const session = await probe.request('/api/auth/get-session');
      const cookie = JSON.parse(await readFile(resolve(root, '.local/probes', probe.environment, 'session.json'), 'utf8')).cookie;
      const record = await probe.request('/api/probe/records', { method: 'POST', body: { title: `Deployment evidence ${probe.environment}` } });
      const key = `reuse-${suffix}`, content = `private-${probe.environment}-${suffix}`;
      await probe.request(`/api/probe/files/${key}`, { method: 'PUT', body: content, headers: { 'content-type': 'text/plain' } });
      const workflowId = `probe-reuse-${suffix}`;
      await probe.request(`/api/probe/workflows/${workflowId}`, { method: 'POST', body: { value: probe.environment } });
      await probe.waitFor(`/api/probe/workflows/${workflowId}`, data => data.status.status === 'complete');
      fixtures.push({ probe, userId: session.data.user.id, cookie, recordId: record.data.id, key, content, workflowId, migrations: await migrations(probe.environment) });
    }
    const firstSession = fixtures[0];
    const crossSession = await prod.request('/api/auth/get-session', { auth: false, headers: { cookie: firstSession.cookie } });
    assert.equal(crossSession.data, null);
    const crossRecord = await prod.request(`/api/probe/records/${firstSession.recordId}`, { acceptFailure: true }); assert.equal(crossRecord.status, 404);
    const unauthFile = await dev.request(`/api/probe/files/${firstSession.key}`, { auth: false, acceptFailure: true }); assert.equal(unauthFile.status, 401);
    cases.push({ id: 'environment-isolation', status: 'pass', expected: 'Distinct D1/R2/Workflow resources, secrets and sessions', actual: 'Distinct remote resources; dev cookie rejected in prod; foreign record 404 and unauthenticated file 401', cloudIds: [crossSession.ray,crossRecord.ray,unauthFile.ray] });
    for (const title of [undefined, 'Repeated deployment title probe']) {
      for (const fixture of fixtures) {
        const { probe } = fixture;
        const buildDir = resolve(root, '.local/build', probe.environment);
        const allowedDir = resolve(root, '.local/build') + sep;
        assert.ok(buildDir.startsWith(allowedDir));
        await rm(buildDir, { recursive: true, force: true });
        await deployProbe({ account, subdomain, environment: probe.environment, title });
        const status = await probe.request('/api/probe/status'); assert.equal(status.data.initialized, true);
        assert.equal(status.data.title, title ?? 'Validation probe');
        const session = await probe.request('/api/auth/get-session', { auth: false, headers: { cookie: fixture.cookie } }); assert.equal(session.data.user.id, fixture.userId);
        const record = await probe.request(`/api/probe/records/${fixture.recordId}`); assert.equal(record.data.title, `Deployment evidence ${probe.environment}`);
        const file = await probe.request(`/api/probe/files/${fixture.key}`); assert.equal(file.data, fixture.content);
        const workflow = await probe.request(`/api/probe/workflows/${fixture.workflowId}`); assert.equal(workflow.data.result.value, probe.environment);
        assert.deepEqual(await migrations(probe.environment), fixture.migrations);
        const bootstrap = await probe.request('/api/probe/bootstrap', { method: 'POST', body: { name: 'Must not reopen', email: 'closed@example.invalid', password: 'Validation-password-2026' }, acceptFailure: true }); assert.equal(bootstrap.status, 409);
      }
      const current = await snapshot(); assert.deepEqual(current.bindings, initial.bindings); captures.push(current);
      console.log(`resource/session/migration reuse: ${title ? 'title-only change' : 'clean rebuild'} pass`);
    }
    const resourceIds = initial.bindings.flatMap(x => [x.database.database_id,...x.workflows.map(w => w.id ?? w.name)]);
    for (const [id, description] of [['resource-reuse','Remote D1/R2/Workflow mappings remain identical across three inventories'],['session-continuity','Original cookies, users, records, files, bootstrap closure and Workflow results survive clean rebuilds'],['migration-once','Migration names and original applied_at timestamps are unchanged']]) cases.push({ id, status: 'pass', expected: description, actual: description, cloudIds: resourceIds });
    const binding = dev.target.d1_databases[0];
    assert.equal(reconcileDatabase({ database_name: binding.database_name }, initial.databases), binding.database_id);
    cases.push({ id: 'lost-response-recovery', status: 'pass', expected: 'Recover a missing local database ID by stable remote name', actual: 'Discarded the local ID in memory and recovered the same actual UUID; no create operation was called', cloudIds: [binding.database_id] });
    const unknown = await prod.request('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_untrusted_probe', livemode: false }, auth: false, acceptFailure: true });
    assert.equal(unknown.status, 503);
    cases.push({ id: 'unknown-signing-secret-not-ready', status: 'pass', expected: 'An unknown webhook signing secret is never ready', actual: 'Actual deployed webhook returned 503 before reading an unverified event', cloudIds: [unknown.ray] });
    for (const id of ['stripe-sandbox-reuse','price-versioning']) cases.push({ id, status: 'waived', expected: 'Real two-Sandbox Stripe validation', actual: 'Not executed: user explicitly waived unavailable Stripe Sandboxes', cloudIds: [] });
  } catch (error) { failure = error; console.error(error.message); }
  const inventoryPath = resolve(evidenceDir, 'resource-inventories.json');
  await mkdir(evidenceDir, { recursive: true }); await writeFile(inventoryPath, JSON.stringify(captures, null, 2));
  const prodJournal = resolve(evidenceDir, 'prod-requests.json'); await writeFile(prodJournal, JSON.stringify(prod.journal, null, 2));
  const report = await dev.save({ status: failure ? 'fail' : 'pass', cases, stripeMode: 'waived', stripeException: 'stripe-sandbox-2026-10-17', paymentValidation: 'unverified', stripeAccounts: [], evidence: [inventoryPath,prodJournal].map(path => ({ path: relative(root,path).replaceAll('\\','/'), sha256: sha256(path === inventoryPath ? JSON.stringify(captures,null,2) : JSON.stringify(prod.journal,null,2)), source: 'cloudflare' })), ...(failure ? { blockers: [failure.message] } : {}) });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name)+1];
  if (!args.includes('--account') || !args.includes('--subdomain')) throw Error('Required: --account <id> --subdomain <workers.dev subdomain>');
  const report = await runDeploymentProbe({ account: option('--account'), subdomain: option('--subdomain') });
  if (report.status !== 'pass') process.exitCode = 1;
}
