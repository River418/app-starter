import { Hono } from 'hono';
import { z } from 'zod';
import type { ProbeEnvironment } from '../../deployment/src/index.ts';
import { createAuth } from '../../deployment/src/auth.ts';
import { dispatchOutbox } from './outbox.ts';
import { cancelRun, claimRun, completeRun, confirmRun, createRun, finishPreparation, readRun } from './store.ts';

export const recovery = new Hono<{ Bindings: ProbeEnvironment; Variables: { owner: string } }>();
recovery.use('*', async (c, next) => {
  if (c.req.path.endsWith('/maintenance')) return next();
  const user = (await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }))?.user;
  if (!user) return c.json({ error: 'Login required' }, 401);
  c.set('owner', user.id);
  await next();
});
recovery.post('/maintenance', async c => c.json({ delivered: await dispatchOutbox(c.env), at: new Date().toISOString() }));
const input = z.object({ operationId: z.string().min(1).max(100), approval: z.boolean().default(false), mode: z.enum(['normal','commit-before-dispatch','ack-lost','early-confirm','retry-once','always-fail','lease-expiry','hold-commit','manual-race']).default('normal') });
recovery.post('/runs', async c => {
  const parsed = input.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid probe run' }, 400);
  try {
    const run = await createRun(c.env.DB, { ...parsed.data, owner: c.get('owner') });
    if (!['commit-before-dispatch','manual-race'].includes(run.mode)) await dispatchOutbox(c.env);
    return c.json({ run }, 201);
  } catch { return c.json({ error: 'Probe quota or operation conflict' }, 409); }
});
recovery.get('/runs/:id', async c => {
  const run = await readRun(c.env.DB, c.req.param('id'));
  if (!run || run.owner_id !== c.get('owner')) return c.json({ error: 'Not found' }, 404);
  const [reservation, result, usage, outbox] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM recovery_reservations WHERE run_id = ?').bind(run.id).first(),
    c.env.DB.prepare('SELECT * FROM recovery_results WHERE run_id = ?').bind(run.id).first(),
    c.env.DB.prepare('SELECT kind, step_key, units, cost_units FROM recovery_usage WHERE run_id = ? ORDER BY created_at').bind(run.id).all(),
    c.env.DB.prepare('SELECT kind, state, attempts, lease_until FROM recovery_outbox WHERE run_id = ?').bind(run.id).all(),
  ]);
  return c.json({ run, reservation, result, usage: usage.results, outbox: outbox.results });
});
recovery.post('/runs/:id/confirm', async c => {
  const parsed = z.object({ operationId: z.string(), expectedVersion: z.number().int(), deferDelivery: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid confirmation' }, 400);
  const approved = await confirmRun(c.env.DB, { ...parsed.data, id: c.req.param('id'), owner: c.get('owner') });
  if (approved && !parsed.data.deferDelivery) await dispatchOutbox(c.env);
  return c.json({ approved }, approved ? 200 : 409);
});
recovery.post('/runs/:id/cancel', async c => c.json({ cancelled: await cancelRun(c.env.DB, c.req.param('id'), c.get('owner')) }));
recovery.post('/runs/:id/fault', async c => {
  const run = await readRun(c.env.DB, c.req.param('id'));
  if (!run || run.owner_id !== c.get('owner')) return c.json({ error: 'Not found' }, 404);
  const fault = z.enum(['execution-lease','approval-deadline','outbox-lease']).safeParse((await c.req.json().catch(() => ({}))).fault);
  if (!fault.success) return c.json({ error: 'Unknown fault' }, 400);
  const sql = fault.data === 'execution-lease' ? 'UPDATE recovery_runs SET lease_until = unixepoch() - 1 WHERE id = ? AND state = \'running\'' : fault.data === 'approval-deadline' ? 'UPDATE recovery_runs SET approval_expires_at = unixepoch() - 1 WHERE id = ? AND state = \'waiting_approval\'' : 'UPDATE recovery_outbox SET lease_until = unixepoch() - 1 WHERE run_id = ? AND state = \'leased\'';
  await c.env.DB.prepare(sql).bind(run.id).run();
  return c.json({ injected: fault.data });
});
recovery.post('/runs/:id/compete', async c => {
  const initial = await readRun(c.env.DB, c.req.param('id'));
  if (!initial || initial.owner_id !== c.get('owner') || initial.mode !== 'manual-race') return c.json({ error: 'Not found' }, 404);
  const winner = z.enum(['cancel','success','concurrent']).safeParse((await c.req.json().catch(() => ({}))).winner);
  if (!winner.success) return c.json({ error: 'Invalid race' }, 400);
  const claimed = await claimRun(c.env.DB, initial.id);
  if (!claimed || !await finishPreparation(c.env.DB, claimed, false)) return c.json({ error: 'Race already started' }, 409);
  const run = (await readRun(c.env.DB, initial.id))!;
  let completed: boolean, cancelled: boolean;
  if (winner.data === 'cancel') { cancelled = await cancelRun(c.env.DB, run.id, run.owner_id); completed = await completeRun(c.env.DB, run); }
  else if (winner.data === 'success') { completed = await completeRun(c.env.DB, run); cancelled = await cancelRun(c.env.DB, run.id, run.owner_id); }
  else [completed, cancelled] = await Promise.all([completeRun(c.env.DB, run), cancelRun(c.env.DB, run.id, run.owner_id)]);
  return c.json({ completed, cancelled, state: (await readRun(c.env.DB, run.id))!.state });
});
