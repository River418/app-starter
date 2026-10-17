import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Hono, type Context } from 'hono';
import Stripe from 'stripe';
import { z } from 'zod';
import { createAuth } from './auth.ts';

export interface ProbeEnvironment {
  DB: D1Database;
  FILES: R2Bucket;
  BOOTSTRAP_WORKFLOW: Workflow<{ value: string }>;
  PROBE_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  PROBE_ENV: string;
  PROBE_TITLE: string;
  STRIPE_WEBHOOK_SECRET?: string;
}
type ProbeContext = Context<{ Bindings: ProbeEnvironment }>;

const app = new Hono<{ Bindings: ProbeEnvironment }>();
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/stripe/webhook') return next();
  const supplied = Buffer.from(c.req.header('x-probe-key') ?? '');
  const expected = Buffer.from(c.env.PROBE_KEY ?? '');
  if (expected.length === 0) return c.json({ error: 'Probe credentials not configured' }, 503);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});

app.get('/api/probe/status', async (c) => {
  const state = await c.env.DB.prepare('SELECT initialized FROM probe_state WHERE id = 1').first<{ initialized: number }>();
  const count = await c.env.DB.prepare('SELECT count(*) AS n FROM probe_records').first<{ n: number }>();
  return c.json({ environment: c.env.PROBE_ENV, title: c.env.PROBE_TITLE, initialized: state?.initialized === 2, recordCount: count?.n ?? 0 });
});

app.post('/api/probe/bootstrap', async (c) => {
  const body = await c.req.text();
  if (new TextEncoder().encode(body).byteLength > 4096) return c.json({ error: 'Body too large' }, 413);
  const claim = await c.env.DB.prepare('UPDATE probe_state SET initialized = 1 WHERE id = 1 AND initialized = 0').run();
  if (claim.meta.changes !== 1) return c.json({ error: 'Bootstrap already claimed or completed' }, 409);
  try {
    const url = new URL('/api/auth/sign-up/email', c.env.BETTER_AUTH_URL);
    const response = await createAuth(c.env).handler(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }));
    await c.env.DB.prepare('UPDATE probe_state SET initialized = ? WHERE id = 1 AND initialized = 1').bind(response.ok ? 2 : 0).run();
    return response;
  } catch (error) {
    await c.env.DB.prepare('UPDATE probe_state SET initialized = 0 WHERE id = 1 AND initialized = 1').run();
    throw error;
  }
});

// Probe-key protected registration is deliberately separate from one-time bootstrap.
app.post('/api/probe/register', async (c) => {
  const body = await c.req.text();
  if (new TextEncoder().encode(body).byteLength > 4096) return c.json({ error: 'Body too large' }, 413);
  return createAuth(c.env).handler(new Request(new URL('/api/auth/sign-up/email', c.env.BETTER_AUTH_URL), { method: 'POST', headers: c.req.raw.headers, body }));
});

app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  if (c.req.path === '/api/auth/sign-up/email') return c.json({ error: 'Use the protected probe account creation endpoint' }, 403);
  return createAuth(c.env).handler(c.req.raw);
});

async function identity(c: ProbeContext) {
  return (await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }))?.user ?? null;
}

app.post('/api/probe/records', async (c) => {
  const user = await identity(c);
  if (!user) return c.json({ error: 'Login required' }, 401);
  const parsed = z.object({ title: z.string().min(1).max(100) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid record' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO probe_records (id, owner_id, title) VALUES (?, ?, ?)').bind(id, user.id, parsed.data.title).run();
  return c.json({ id }, 201);
});

app.get('/api/probe/records/:id', async (c) => {
  const user = await identity(c);
  if (!user) return c.json({ error: 'Login required' }, 401);
  const row = await c.env.DB.prepare('SELECT id, title FROM probe_records WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), user.id).first();
  return row ? c.json(row) : c.json({ error: 'Not found' }, 404);
});

app.put('/api/probe/files/:key', async (c) => {
  const user = await identity(c);
  if (!user) return c.json({ error: 'Login required' }, 401);
  if (!/^[a-z0-9-]{1,64}$/.test(c.req.param('key'))) return c.json({ error: 'Invalid file key' }, 400);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 1024) return c.json({ error: 'File exceeds probe limit' }, 413);
  await c.env.FILES.put(`${user.id}/${c.req.param('key')}`, body);
  return c.json({ ok: true }, 201);
});

app.get('/api/probe/files/:key', async (c) => {
  const user = await identity(c);
  if (!user) return c.json({ error: 'Login required' }, 401);
  const file = await c.env.FILES.get(`${user.id}/${c.req.param('key')}`);
  return file ? new Response(file.body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store' } }) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/probe/workflows/:id', async (c) => {
  const parsed = z.object({ value: z.string().max(100) }).safeParse(await c.req.json().catch(() => null));
  const id = c.req.param('id');
  if (!/^probe-[a-z0-9-]{1,50}$/.test(id) || !parsed.success) return c.json({ error: 'Invalid workflow probe' }, 400);
  await c.env.BOOTSTRAP_WORKFLOW.create({ id, params: parsed.data });
  return c.json({ id }, 201);
});

app.get('/api/probe/workflows/:id', async (c) => {
  const id = c.req.param('id');
  const instance = await c.env.BOOTSTRAP_WORKFLOW.get(id);
  const result = await c.env.DB.prepare('SELECT value FROM probe_workflow_results WHERE instance_id = ?').bind(id).first();
  return c.json({ status: await instance.status(), result });
});

app.post('/api/stripe/webhook', async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: 'Signing secret not ready' }, 503);
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(await c.req.text(), c.req.header('stripe-signature') ?? '', c.env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider());
  } catch { return c.json({ error: 'Invalid signature' }, 400); }
  if (event.livemode) return c.json({ error: 'Disposable probes reject live events' }, 400);
  await c.env.DB.prepare('INSERT INTO probe_stripe_events (id, kind) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(event.id, event.type).run();
  return c.json({ received: true });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((_error, c) => c.json({ error: 'Probe request failed' }, 500));

export class BootstrapProbeWorkflow extends WorkflowEntrypoint<ProbeEnvironment, { value: string }> {
  async run(event: WorkflowEvent<{ value: string }>, step: WorkflowStep) {
    return step.do('persist-probe', { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '30 seconds' }, async () => {
      await this.env.DB.prepare('INSERT INTO probe_workflow_results (instance_id, value) VALUES (?, ?) ON CONFLICT(instance_id) DO NOTHING').bind(event.instanceId, event.payload.value).run();
      const row = await this.env.DB.prepare('SELECT value FROM probe_workflow_results WHERE instance_id = ?').bind(event.instanceId).first<{ value: string }>();
      return { value: row!.value };
    });
  }
}

export default app;
