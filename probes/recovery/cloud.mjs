import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { openProbe, root, sha256, startTail } from '../shared/cloud.mjs';

const probe = await openProbe('dev', 'recovery');
const tail = await startTail('dev', probe.evidenceDir);
const prefix = '/api/probe/recovery';
const cases = [], allRuns = [], suffix = Date.now();
const get = id => probe.request(`${prefix}/runs/${id}`).then(r => r.data);
const post = (path, body = {}) => probe.request(prefix + path, { method: 'POST', body });
async function create(name, options = {}) {
  const response = await post('/runs', { operationId: `${name}-${suffix}`, ...options });
  const id = response.data.run.id;
  allRuns.push(id);
  return id;
}
const settled = data => ['succeeded','cancelled','failed','expired'].includes(data.run.state);
async function wait(id, predicate = settled) { return probe.waitFor(`${prefix}/runs/${id}`, predicate); }
function conserved(data) {
  assert.equal(data.reservation.reserved, data.reservation.consumed + data.reservation.released);
  assert.equal(data.reservation.slot_active, 0);
  const charges = data.usage.filter(x => x.kind === 'user_step');
  assert.equal(new Set(charges.map(x => x.step_key)).size, charges.length);
  assert.equal(charges.reduce((sum, x) => sum + x.units, 0), data.reservation.consumed);
  assert.equal(Boolean(data.result), data.run.state === 'succeeded');
}
async function check(id, description, test) {
  const started = Date.now();
  try {
    const ids = await test();
    cases.push({ id, status: 'pass', expected: description, actual: `${description}; assertions passed in ${Date.now() - started}ms`, cloudIds: ids });
    console.log(`${id}: pass`);
  } catch (error) {
    cases.push({ id, status: 'fail', expected: description, actual: error.message, cloudIds: [] });
    throw error;
  }
}
let failure;
try {
  // Cron configuration can take up to 15 minutes to propagate. Start the recovery
  // stopwatch only after this deployment has received a real Scheduled event.
  const readinessStarted = Date.now();
  while (!tail.frames().some(f => f.event?.cron === '* * * * *' && f.scriptName === probe.target.name)) {
    if (Date.now() - readinessStarted > 900000) throw Error('Real Cron not ready within its documented propagation window');
    await pause(1000);
  }
  console.log('real-scheduled-readiness: observed');
  await check('commit-before-dispatch', 'Real minute Scheduled recovers a committed, undispatched run within 150 seconds', async () => {
    const started = Date.now(), id = await create('undispatched', { mode: 'commit-before-dispatch' });
    assert.equal(probe.journal.findLast(x => x.response?.run?.id === id && x.method === 'POST')?.response.run.state, 'queued');
    const result = await wait(id);
    assert.equal(result.run.state, 'succeeded');
    assert.ok(Date.now() - started <= 150000);
    conserved(result);
    return [id, ...probe.journal.filter(x => x.path.endsWith(id)).map(x => x.ray).filter(Boolean)];
  });
  const timeoutId = await create('natural-confirm-timeout', { approval: true });
  const leaseId = await create('lease-expiry', { mode: 'lease-expiry' });
  await check('instance-ack-lost', 'Lost create acknowledgement reuses the stable Workflow ID on real Scheduled replay', async () => {
    const id = await create('lost-ack', { approval: true, mode: 'ack-lost' });
    const waiting = await wait(id, x => x.run.state === 'waiting_approval');
    await post(`/runs/${id}/fault`, { fault: 'outbox-lease' });
    await wait(id, x => x.outbox.some(o => o.kind === 'start' && o.attempts >= 2 && o.state === 'delivered'));
    await post(`/runs/${id}/confirm`, { operationId: waiting.run.approval_id, expectedVersion: waiting.run.version });
    const result = await wait(id);
    assert.equal(result.run.state, 'succeeded'); conserved(result);
    return [id];
  });
  let earlyId, earlyApproval;
  await check('early-confirmation', 'A durable approval delivered before wait resumes exactly once', async () => {
    earlyId = await create('early-confirmation', { approval: true, mode: 'early-confirm' });
    const waiting = await wait(earlyId, x => x.run.state === 'waiting_approval');
    earlyApproval = { operationId: waiting.run.approval_id, expectedVersion: waiting.run.version };
    await post(`/runs/${earlyId}/confirm`, earlyApproval);
    const result = await wait(earlyId); assert.equal(result.run.state, 'succeeded'); conserved(result);
    return [earlyId];
  });
  await check('duplicate-confirmation', 'Repeating the same decision does not advance a terminal version or charge twice', async () => {
    const before = await get(earlyId);
    await post(`/runs/${earlyId}/confirm`, earlyApproval);
    const after = await get(earlyId);
    assert.equal(after.run.version, before.run.version); assert.deepEqual(after.reservation, before.reservation); conserved(after);
    return [earlyId];
  });
  await check('expired-confirmation', 'Expired approval cannot authorize a write or consume unfinished units', async () => {
    const id = await create('expired-confirmation', { approval: true });
    const waiting = await wait(id, x => x.run.state === 'waiting_approval');
    await post(`/runs/${id}/fault`, { fault: 'approval-deadline' });
    const response = await probe.request(`${prefix}/runs/${id}/confirm`, { method: 'POST', body: { operationId: waiting.run.approval_id, expectedVersion: waiting.run.version }, acceptFailure: true });
    assert.equal(response.status, 409); await post('/maintenance');
    const result = await wait(id); assert.equal(result.run.state, 'expired'); conserved(result);
    return [id, response.ray];
  });
  for (const [caseId, winner] of [['cancel-wins','cancel'],['success-wins','success'],['cancel-commit-race','concurrent']]) {
    await check(caseId, `Twenty real D1 ${winner} races have one winner, at most one result and conserved usage`, async () => {
      const ids = [];
      for (let i = 0; i < 20; i++) {
        const id = await create(`${caseId}-${i}`, { mode: 'manual-race' }); ids.push(id);
        const race = await post(`/runs/${id}/compete`, { winner });
        assert.equal(Number(race.data.completed) + Number(race.data.cancelled), 1);
        if (winner !== 'concurrent') assert.equal(race.data.state, winner === 'cancel' ? 'cancelled' : 'succeeded');
        conserved(await get(id));
      }
      return ids;
    });
  }
  await check('lease-recovery', 'An abandoned execution lease expires without a result or leaked slot', async () => {
    const result = await wait(leaseId); assert.equal(result.run.state, 'expired'); conserved(result);
    return [leaseId];
  });
  await check('duplicate-scheduler', 'Concurrent replays of the same maintenance handler do not duplicate instance or settlement', async () => {
    const id = await create('duplicate-maintenance', { mode: 'commit-before-dispatch' });
    await Promise.all([post('/maintenance'), post('/maintenance')]);
    const result = await wait(id); assert.equal(result.run.state, 'succeeded'); conserved(result);
    return [id];
  });
  await check('retry-budget', 'One extra provider attempt is allowed; exhausted retries fail and release the reservation', async () => {
    const ids = [];
    for (const mode of ['retry-once','always-fail']) {
      const id = await create(mode, { mode }); ids.push(id);
      const result = await wait(id);
      assert.equal(result.run.state, mode === 'retry-once' ? 'succeeded' : 'failed');
      assert.equal(result.usage.filter(x => x.kind === 'provider_attempt').length, 2); conserved(result);
    }
    return ids;
  });
  await check('confirmation-timeout', 'Real waitForEvent/approval deadline expires an unconfirmed proposal and settles its reservation', async () => {
    const result = await wait(timeoutId); assert.equal(result.run.state, 'expired'); conserved(result);
    return [timeoutId];
  });
  await check('usage-conservation', 'Every run is terminal, has zero held units and slot, and at most one result', async () => {
    for (const id of allRuns) conserved(await get(id));
    return allRuns;
  });
} catch (error) { failure = error; console.error(error.message); }
finally {
  const trace = await tail.stop();
  const scheduled = trace.frames.filter(f => f.event?.cron === '* * * * *');
  if (!scheduled.length) { failure ??= Error('No actual Cloudflare Scheduled trace collected'); console.error('Scheduled trace missing'); }
  await probe.save({ status: failure ? 'fail' : 'pass', cases, scheduledInvocations: scheduled.map(f => ({ at: f.eventTimestamp, outcome: f.outcome, cpuTimeMs: f.cpuTime, wallTimeMs: f.wallTime })), raceSamplesPerBoundary: 20, deterministicProvider: true, evidence: [{ path: trace.path, sha256: sha256(await readFile(resolve(root, trace.path))), source: 'cloudflare' }], ...(failure ? { blockers: [failure.message] } : {}) });
}
if (failure) process.exitCode = 1;
