import { Hono } from 'hono';
import { z } from 'zod';
import type { ProbeEnvironment } from '../../deployment/src/index.ts';
import { createAuth } from '../../deployment/src/auth.ts';
import { cancelChat, createChatThread, loadChatThread, runChat } from './chat.ts';
import { modelFor } from './model.ts';

export const modelProbe = new Hono<{ Bindings: ProbeEnvironment; Variables: { owner: string } }>();
modelProbe.use('*', async (c, next) => {
  const user = (await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }))?.user;
  if (!user) return c.json({ error: 'Login required' }, 401);
  c.set('owner', user.id); await next();
});
modelProbe.post('/threads', async c => {
  const parsed = z.object({ scenario: z.enum(['text','read','write','cancel']) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid scenario' }, 400);
  return c.json({ thread: await createChatThread(c.env.DB, c.get('owner'), parsed.data.scenario) }, 201);
});
modelProbe.get('/threads/:id', async c => {
  const thread = await loadChatThread(c.env.DB, c.get('owner'), c.req.param('id'));
  if (!thread) return c.json({ error: 'Not found' }, 404);
  const runs = await c.env.DB.prepare('SELECT id, state, model_calls, input_tokens, output_tokens, text_deltas, first_delta_ms, last_delta_ms, request_aborted, provider_aborted FROM model_runs WHERE thread_id = ? ORDER BY created_at, rowid').bind(thread.id).all();
  return c.json({ thread, runs: runs.results });
});
modelProbe.post('/chat/:id', c => runChat(c.env, c.get('owner'), c.req.param('id'), c.req.raw, modelFor(c.env.AI), work => c.executionCtx.waitUntil(work)));
modelProbe.post('/threads/:id/cancel', async c => {
  if (!await loadChatThread(c.env.DB, c.get('owner'), c.req.param('id'))) return c.json({ error: 'Not found' }, 404);
  await cancelChat(c.env.DB, c.get('owner'), c.req.param('id'));
  return c.json({ cancelled: true });
});
modelProbe.post('/workflows/:id', async c => {
  const id = c.req.param('id');
  if (!/^probe-model-[a-z0-9-]{1,50}$/.test(id)) return c.json({ error: 'Invalid instance ID' }, 400);
  const body = z.object({ prompt: z.string().min(1).max(2048) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid model prompt' }, 400);
  if (await c.env.DB.prepare('SELECT instance_id FROM model_workflow_owners WHERE instance_id = ?').bind(id).first()) return c.json({ error: 'Instance already claimed' }, 409);
  const thread = await createChatThread(c.env.DB, c.get('owner'), 'text');
  await c.env.DB.prepare('INSERT INTO model_workflow_owners (instance_id, owner_id, thread_id) VALUES (?, ?, ?)').bind(id, c.get('owner'), thread.id).run();
  await c.env.MODEL_WORKFLOW.create({ id, params: { threadId: thread.id, prompt: body.data.prompt } });
  return c.json({ id, threadId: thread.id }, 201);
});
modelProbe.get('/workflows/:id', async c => {
  if (!await c.env.DB.prepare('SELECT instance_id FROM model_workflow_owners WHERE instance_id = ? AND owner_id = ?').bind(c.req.param('id'), c.get('owner')).first()) return c.json({ error: 'Not found' }, 404);
  const result = await c.env.DB.prepare('SELECT value FROM probe_workflow_results WHERE instance_id = ?').bind(c.req.param('id')).first<string>('value');
  return c.json({ status: await (await c.env.MODEL_WORKFLOW.get(c.req.param('id'))).status(), result: result ? JSON.parse(result) : null });
});
