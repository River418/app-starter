import { expireLeases, readRun } from './store.ts';
export interface RecoveryEnvironment { DB: D1Database; RUN_WORKFLOW: Workflow<{ runId: string }> }
interface Outbox { id: string; run_id: string; kind: 'start' | 'confirm'; lease_token: string; attempts: number }

export async function dispatchOutbox(env: RecoveryEnvironment): Promise<number> {
  await expireLeases(env.DB);
  const token = crypto.randomUUID();
  const rows = await env.DB.prepare(`UPDATE recovery_outbox SET state = 'leased', lease_token = ?, lease_until = unixepoch() + 15, attempts = attempts + 1
    WHERE id IN (SELECT id FROM recovery_outbox WHERE (state = 'pending' AND next_attempt_at <= unixepoch()) OR (state = 'leased' AND lease_until <= unixepoch()) ORDER BY created_at LIMIT 20) RETURNING *`).bind(token).all<Outbox>();
  let delivered = 0;
  for (const row of rows.results) {
    try {
      const run = await readRun(env.DB, row.run_id);
      if (!run || ['succeeded','cancelled','failed','expired'].includes(run.state)) {
        await env.DB.prepare("UPDATE recovery_outbox SET state = 'obsolete' WHERE id = ? AND lease_token = ? AND state = 'leased'").bind(row.id, token).run();
        continue;
      }
      if (row.kind === 'start') {
        const result = await env.RUN_WORKFLOW.createBatch({ instances: [{ id: run.id, params: { runId: run.id } }] });
        if (result.errors.length) {
          if (result.errors.length !== 1 || result.errors[0].code !== 10405 || result.errors[0].id !== run.id) throw Error('Workflow creation failed');
          // An explicit duplicate plus a readable existing instance is the only accepted recovery.
          await (await env.RUN_WORKFLOW.get(run.id)).status();
        }
        if (run.mode === 'ack-lost' && row.attempts === 1) continue;
      } else {
        if (!run.approved_at || !run.approval_id) throw Error('Confirmation not durably approved');
        await (await env.RUN_WORKFLOW.get(run.id)).sendEvent({ type: `confirm-${run.approval_id}`, payload: { approvalId: run.approval_id } });
      }
      const ack = await env.DB.prepare("UPDATE recovery_outbox SET state = 'delivered', lease_until = NULL WHERE id = ? AND state = 'leased' AND lease_token = ?").bind(row.id, token).run();
      delivered += ack.meta.changes;
    } catch {
      // A crashed or failed delivery retains its bounded lease for a later Scheduled retry.
      console.warn('Probe outbox delivery pending', row.run_id, row.kind, row.attempts);
    }
  }
  return delivered;
}
