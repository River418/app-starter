import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createRun, claimRun, finishPreparation, completeRun, cancelRun, confirmRun, readRun, expireLeases } from './src/store.ts';
import { dispatchOutbox } from './src/outbox.ts';

async function ready(operationId: string, approval = false) {
  const run = await createRun(env.DB, { owner: 'owner-a', operationId, approval });
  const claimed = await claimRun(env.DB, run.id);
  expect(claimed).not.toBeNull();
  await finishPreparation(env.DB, claimed!, approval);
  return (await readRun(env.DB, run.id))!;
}

async function conservation(id: string) {
  const reservation = await env.DB.prepare('SELECT * FROM recovery_reservations WHERE run_id = ?').bind(id).first<{ reserved: number; consumed: number; released: number; slot_active: number }>();
  expect(reservation!.reserved).toBe(reservation!.consumed + reservation!.released);
  expect(reservation!.slot_active).toBe(0);
  const charges = await env.DB.prepare("SELECT step_key, count(*) AS n FROM recovery_usage WHERE run_id = ? AND kind = 'user_step' GROUP BY step_key").bind(id).all<{ n: number }>();
  expect(charges.results.every(x => x.n === 1)).toBe(true);
}

describe('real D1 recovery state and atomic settlement', () => {
  it('commits run, reservation and outbox together and deduplicates operation IDs', async () => {
    const first = await createRun(env.DB, { owner: 'owner-a', operationId: 'stable-operation', approval: false });
    expect((await createRun(env.DB, { owner: 'owner-a', operationId: 'stable-operation', approval: false })).id).toBe(first.id);
    await expect(createRun(env.DB, { owner: 'owner-a', operationId: 'stable-operation', approval: true })).rejects.toThrow(/conflict/i);
    for (const table of ['recovery_runs', 'recovery_reservations', 'recovery_outbox']) expect(await env.DB.prepare(`SELECT count(*) FROM ${table}`).first('count(*)')).toBe(1);
  });

  it('rejects early, stale, foreign and expired confirmation; accepts one durable decision', async () => {
    const early = await createRun(env.DB, { owner: 'owner-a', operationId: 'early', approval: true });
    expect(await confirmRun(env.DB, { id: early.id, owner: 'owner-a', operationId: 'confirm-early', expectedVersion: early.version })).toBe(false);
    const run = await ready('approval', true);
    const decision = { id: run.id, owner: 'owner-a', operationId: run.approval_id!, expectedVersion: run.version };
    expect(await confirmRun(env.DB, { ...decision, owner: 'owner-b' })).toBe(false);
    expect(await confirmRun(env.DB, { ...decision, expectedVersion: run.version - 1 })).toBe(false);
    expect(await confirmRun(env.DB, decision)).toBe(true);
    expect(await confirmRun(env.DB, decision)).toBe(true);
    expect((await readRun(env.DB, run.id))!.version).toBe(run.version + 1);
    expect(await env.DB.prepare("SELECT count(*) FROM recovery_outbox WHERE run_id = ? AND kind = 'confirm'").bind(run.id).first('count(*)')).toBe(1);
    const resumed = await claimRun(env.DB, run.id);
    expect(resumed!.phase).toBe('commit');
    expect(await completeRun(env.DB, resumed!)).toBe(true);
    await conservation(run.id);
    const expired = await ready('expired-confirmation', true);
    await env.DB.prepare('UPDATE recovery_runs SET approval_expires_at = unixepoch() - 1 WHERE id = ?').bind(expired.id).run();
    expect(await confirmRun(env.DB, { id: expired.id, owner: 'owner-a', operationId: expired.approval_id!, expectedVersion: expired.version })).toBe(false);
  });

  it('keeps cancellation and success atomic across twenty real concurrent D1 races', async () => {
    for (let i = 0; i < 20; i++) {
      const run = await ready(`concurrent-${i}`);
      const [completed, cancelled] = await Promise.all([completeRun(env.DB, run), cancelRun(env.DB, run.id, run.owner_id)]);
      expect(Number(completed) + Number(cancelled)).toBe(1);
      const stored = (await readRun(env.DB, run.id))!;
      const results = await env.DB.prepare('SELECT count(*) FROM recovery_results WHERE run_id = ?').bind(run.id).first<number>('count(*)');
      expect(results).toBe(stored.state === 'succeeded' ? 1 : 0);
      expect(await completeRun(env.DB, run)).toBe(false);
      await conservation(run.id);
    }
  });

  it('preserves completed-step charges and releases only unfinished work on cancellation', async () => {
    const run = await ready('cancel-first');
    expect(await cancelRun(env.DB, run.id, run.owner_id)).toBe(true);
    expect(await completeRun(env.DB, run)).toBe(false);
    const amounts = await env.DB.prepare('SELECT consumed, released FROM recovery_reservations WHERE run_id = ?').bind(run.id).first();
    expect(amounts).toEqual({ consumed: 1, released: 1 });
    await conservation(run.id);
    const success = await ready('success-first');
    expect(await completeRun(env.DB, success)).toBe(true);
    expect(await cancelRun(env.DB, success.id, success.owner_id)).toBe(false);
    await conservation(success.id);
  });

  it('reclaims expired execution leases once and fences off late commits', async () => {
    const run = await ready('lease-expired');
    await env.DB.prepare('UPDATE recovery_runs SET lease_until = unixepoch() - 1 WHERE id = ?').bind(run.id).run();
    expect(await expireLeases(env.DB)).toBe(1);
    expect(await expireLeases(env.DB)).toBe(0);
    expect(await completeRun(env.DB, run)).toBe(false);
    expect((await readRun(env.DB, run.id))!.state).toBe('expired');
    await conservation(run.id);
  });

  it('recovers commit-before-dispatch using a real Workflow with one settled result', async () => {
    const run = await createRun(env.DB, { owner: 'owner-a', operationId: 'dispatch-recovery', approval: false });
    await using inspector = await introspectWorkflowInstance(env.RUN_WORKFLOW, run.id);
    await dispatchOutbox(env);
    await inspector.waitForStatus('complete');
    expect((await readRun(env.DB, run.id))!.state).toBe('succeeded');
    expect(await env.DB.prepare('SELECT count(*) FROM recovery_results WHERE run_id = ?').bind(run.id).first('count(*)')).toBe(1);
    await conservation(run.id);
  });

  it('deduplicates a lost create acknowledgement and a confirmation delivered before wait', async () => {
    const run = await createRun(env.DB, { owner: 'owner-a', operationId: 'ack-recovery', approval: true, mode: 'ack-lost' });
    await using inspector = await introspectWorkflowInstance(env.RUN_WORKFLOW, run.id);
    await dispatchOutbox(env);
    await inspector.waitForStepResult({ name: 'prepare' });
    await env.DB.prepare("UPDATE recovery_outbox SET lease_until = unixepoch() - 1 WHERE run_id = ? AND kind = 'start'").bind(run.id).run();
    await dispatchOutbox(env);
    const waiting = (await readRun(env.DB, run.id))!;
    expect(await confirmRun(env.DB, { id: run.id, owner: run.owner_id, operationId: waiting.approval_id!, expectedVersion: waiting.version })).toBe(true);
    await dispatchOutbox(env);
    await inspector.waitForStatus('complete');
    expect((await readRun(env.DB, run.id))!.state).toBe('succeeded');
    expect(await env.DB.prepare("SELECT attempts FROM recovery_outbox WHERE run_id = ? AND kind = 'start'").bind(run.id).first('attempts')).toBe(2);
    await conservation(run.id);
  });

  it('records provider attempts separately and charges a successful logical step once', async () => {
    for (const mode of ['retry-once', 'always-fail']) {
      const run = await createRun(env.DB, { owner: 'owner-a', operationId: mode, approval: false, mode });
      await using inspector = await introspectWorkflowInstance(env.RUN_WORKFLOW, run.id);
      await dispatchOutbox(env);
      await inspector.waitForStatus('complete');
      expect((await readRun(env.DB, run.id))!.state).toBe(mode === 'retry-once' ? 'succeeded' : 'failed');
      expect(await env.DB.prepare("SELECT count(*) FROM recovery_usage WHERE run_id = ? AND kind = 'provider_attempt'").bind(run.id).first('count(*)')).toBe(2);
      await conservation(run.id);
    }
  });
});
