export interface Run {
  id: string; owner_id: string; operation_id: string; state: string; phase: string;
  version: number; lease_fence: number; approval_id: string | null;
  approval: number; mode: string; approval_version: number | null;
  approval_expires_at: number | null; approved_at: number | null;
}
const terminal = "'succeeded','cancelled','failed','expired'";
const guard = 'EXISTS (SELECT 1 FROM recovery_runs WHERE id = ? AND transition_token = ?)';

export async function createRun(db: D1Database, input: { owner: string; operationId: string; approval: boolean; mode?: string }): Promise<Run> {
  const id = crypto.randomUUID(), token = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO recovery_runs (id, owner_id, operation_id, approval, mode, state, phase, transition_token, deadline_at)
      SELECT ?, ?, ?, ?, ?, 'queued', 'prepare', ?, unixepoch() + 300
      WHERE (SELECT count(*) FROM recovery_reservations r JOIN recovery_runs t ON t.id = r.run_id WHERE t.owner_id = ? AND r.slot_active = 1) < 4
      AND (SELECT coalesce(sum(r.reserved - r.released),0) FROM recovery_reservations r JOIN recovery_runs t ON t.id = r.run_id WHERE t.owner_id = ?) <= 9998
      ON CONFLICT(owner_id, operation_id) DO NOTHING`).bind(id, input.owner, input.operationId, Number(input.approval), input.mode ?? 'normal', token, input.owner, input.owner),
    db.prepare('INSERT INTO recovery_reservations (run_id, reserved) SELECT id, 2 FROM recovery_runs WHERE id = ? AND transition_token = ?').bind(id, token),
    db.prepare("INSERT INTO recovery_outbox (id, run_id, kind) SELECT id || '-start', id, 'start' FROM recovery_runs WHERE id = ? AND transition_token = ? AND mode != 'manual-race'").bind(id, token),
  ]);
  const run = await db.prepare('SELECT * FROM recovery_runs WHERE owner_id = ? AND operation_id = ?').bind(input.owner, input.operationId).first<Run>();
  if (!run) throw Error('Probe quota exceeded');
  if (run.approval !== Number(input.approval) || run.mode !== (input.mode ?? 'normal')) throw Error('Operation ID conflict');
  return run;
}

export function readRun(db: D1Database, id: string) { return db.prepare('SELECT * FROM recovery_runs WHERE id = ?').bind(id).first<Run>(); }

export async function claimRun(db: D1Database, id: string): Promise<Run | null> {
  return db.prepare(`UPDATE recovery_runs SET phase = CASE WHEN state = 'approved' THEN 'commit' ELSE phase END, state = 'running', version = version + 1, lease_fence = lease_fence + 1, lease_until = unixepoch() + 30
    WHERE id = ? AND state IN ('queued','approved') AND deadline_at > unixepoch() RETURNING *`).bind(id).first<Run>();
}

export async function finishPreparation(db: D1Database, run: Run, approval: boolean): Promise<boolean> {
  const token = crypto.randomUUID(), approvalId = approval ? crypto.randomUUID() : null;
  const result = await db.batch([
    db.prepare(`UPDATE recovery_runs SET state = ?, phase = ?, version = version + 1, transition_token = ?,
      approval_id = ?, approval_version = CASE WHEN ? THEN version + 1 ELSE NULL END,
      approval_expires_at = CASE WHEN ? THEN unixepoch() + 90 ELSE NULL END,
      lease_until = CASE WHEN ? THEN NULL ELSE unixepoch() + 30 END
      WHERE id = ? AND state = 'running' AND phase = 'prepare' AND version = ? AND lease_fence = ? AND lease_until > unixepoch() AND deadline_at > unixepoch()`)
      .bind(approval ? 'waiting_approval' : 'running', approval ? 'approval' : 'commit', token, approvalId, approval, approval, approval, run.id, run.version, run.lease_fence),
    db.prepare(`INSERT INTO recovery_usage (id, run_id, kind, step_key, units) SELECT ?, id, 'user_step', 'prepare', 1 FROM recovery_runs WHERE id = ? AND transition_token = ?`).bind(crypto.randomUUID(), run.id, token),
    db.prepare(`UPDATE recovery_reservations SET consumed = consumed + 1 WHERE run_id = ? AND ${guard}`).bind(run.id, run.id, token),
  ]);
  return result[0].meta.changes === 1;
}

export async function completeRun(db: D1Database, run: Run): Promise<boolean> {
  const token = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`UPDATE recovery_runs SET state = 'succeeded', phase = 'done', version = version + 1, transition_token = ?, lease_until = NULL
      WHERE id = ? AND state = 'running' AND phase = 'commit' AND version = ? AND lease_fence = ? AND lease_until > unixepoch() AND deadline_at > unixepoch()
      AND EXISTS (SELECT 1 FROM recovery_reservations WHERE run_id = recovery_runs.id AND reserved - consumed - released >= 1)`)
      .bind(token, run.id, run.version, run.lease_fence),
    db.prepare("INSERT INTO recovery_results (run_id, value) SELECT id, 'probe-result' FROM recovery_runs WHERE id = ? AND transition_token = ?").bind(run.id, token),
    db.prepare("INSERT INTO recovery_usage (id, run_id, kind, step_key, units) SELECT ?, id, 'user_step', 'commit', 1 FROM recovery_runs WHERE id = ? AND transition_token = ?").bind(crypto.randomUUID(), run.id, token),
    db.prepare(`UPDATE recovery_reservations SET consumed = consumed + 1, released = reserved - consumed - 1, slot_active = 0 WHERE run_id = ? AND ${guard}`).bind(run.id, run.id, token),
    db.prepare(`UPDATE recovery_outbox SET state = 'obsolete' WHERE run_id = ? AND state != 'delivered' AND ${guard}`).bind(run.id, run.id, token),
  ]);
  return result[0].meta.changes === 1;
}

async function terminateRun(db: D1Database, id: string, owner: string, state: 'cancelled' | 'expired' | 'failed', condition = '1 = 1'): Promise<boolean> {
  const token = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`UPDATE recovery_runs SET state = ?, phase = 'done', version = version + 1, transition_token = ?, lease_until = NULL
      WHERE id = ? AND owner_id = ? AND state NOT IN (${terminal}) AND (${condition})`).bind(state, token, id, owner),
    db.prepare(`UPDATE recovery_reservations SET released = reserved - consumed, slot_active = 0 WHERE run_id = ? AND ${guard}`).bind(id, id, token),
    db.prepare(`UPDATE recovery_outbox SET state = 'obsolete' WHERE run_id = ? AND state != 'delivered' AND ${guard}`).bind(id, id, token),
  ]);
  return result[0].meta.changes === 1;
}
export const cancelRun = (db: D1Database, id: string, owner: string) => terminateRun(db, id, owner, 'cancelled');
export const failRun = (db: D1Database, id: string, owner: string) => terminateRun(db, id, owner, 'failed');

export async function confirmRun(db: D1Database, input: { id: string; owner: string; operationId: string; expectedVersion: number }): Promise<boolean> {
  const token = crypto.randomUUID();
  await db.batch([
    db.prepare(`UPDATE recovery_runs SET state = 'approved', version = version + 1, transition_token = ?, approved_at = unixepoch()
      WHERE id = ? AND owner_id = ? AND state = 'waiting_approval' AND approval_id = ? AND version = ? AND approval_expires_at > unixepoch() AND deadline_at > unixepoch()`)
      .bind(token, input.id, input.owner, input.operationId, input.expectedVersion),
    db.prepare("INSERT INTO recovery_outbox (id, run_id, kind) SELECT id || '-confirm', id, 'confirm' FROM recovery_runs WHERE id = ? AND transition_token = ?").bind(input.id, token),
  ]);
  const run = await readRun(db, input.id);
  return !!run && run.owner_id === input.owner && run.approval_id === input.operationId && run.approval_version === input.expectedVersion && run.approved_at !== null;
}

export async function expireLeases(db: D1Database): Promise<number> {
  const condition = "deadline_at <= unixepoch() OR (state = 'running' AND lease_until <= unixepoch()) OR (state = 'waiting_approval' AND approval_expires_at <= unixepoch())";
  const due = await db.prepare(`SELECT id, owner_id FROM recovery_runs WHERE state NOT IN (${terminal}) AND (${condition}) LIMIT 20`).all<Pick<Run, 'id' | 'owner_id'>>();
  let count = 0;
  for (const run of due.results) count += Number(await terminateRun(db, run.id, run.owner_id, 'expired', condition));
  return count;
}
