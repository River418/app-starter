import { env, exports as worker } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const origin = 'http://probe.local';
function call(route: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('x-probe-key', env.PROBE_KEY);
  headers.set('origin', origin);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return worker.default.fetch(new Request(origin + route, { ...options, headers }));
}
const json = (body: unknown) => JSON.stringify(body);
function cookieOf(response: Response) { return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '); }
async function register() {
  const result = await call('/api/probe/bootstrap', { method: 'POST', body: json({ name: 'Probe Owner', email: 'owner@example.invalid', password: 'Validation-password-2026' }) });
  expect(result.status).toBe(200);
  return { response: result, cookie: cookieOf(result) };
}

describe('real local Worker, D1, R2 and Workflow deployment contract', () => {
  it('requires the private probe key before allowing cloud-resource access', async () => {
    const response = await worker.default.fetch(origin + '/api/probe/status');
    expect(response.status).toBe(401);
  });

  it('reuses authentication data and cannot reopen initialized bootstrap', async () => {
    const { cookie } = await register();
    const session = await call('/api/auth/get-session', { headers: { cookie } });
    expect(session.status).toBe(200);
    expect((await session.json() as { user: { email: string } }).user.email).toBe('owner@example.invalid');
    const again = await call('/api/probe/bootstrap', { method: 'POST', body: json({ name: 'Intruder', email: 'other@example.invalid', password: 'Validation-password-2026' }) });
    expect(again.status).toBe(409);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM user').first<{ n: number }>())?.n).toBe(1);
  });

  it('persists owner-scoped records and rejects a request without a session', async () => {
    const { cookie } = await register();
    const created = await call('/api/probe/records', { method: 'POST', headers: { cookie }, body: json({ title: 'Persistent evidence' }) });
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    const loaded = await call(`/api/probe/records/${record.id}`, { headers: { cookie } });
    expect((await loaded.json() as { title: string }).title).toBe('Persistent evidence');
    expect((await call(`/api/probe/records/${record.id}`)).status).toBe(401);
  });

  it('keeps files private and rejects oversized probe uploads', async () => {
    const { cookie } = await register();
    const uploaded = await call('/api/probe/files/evidence', { method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: 'private probe file' });
    expect(uploaded.status).toBe(201);
    expect(new TextDecoder().decode(await (await call('/api/probe/files/evidence', { headers: { cookie } })).arrayBuffer())).toBe('private probe file');
    expect((await call('/api/probe/files/evidence')).status).toBe(401);
    expect((await call('/api/probe/files/large', { method: 'PUT', headers: { cookie }, body: 'x'.repeat(1025) })).status).toBe(413);
  });

  it('executes the actual Workflow and commits exactly one result', async () => {
    await using inspector = await introspectWorkflowInstance(env.BOOTSTRAP_WORKFLOW, 'probe-bootstrap-one');
    await env.BOOTSTRAP_WORKFLOW.create({ id: 'probe-bootstrap-one', params: { value: 'durable' } });
    await inspector.waitForStatus('complete');
    expect(await inspector.getOutput()).toEqual({ value: 'durable' });
    expect(await env.DB.prepare('SELECT value FROM probe_workflow_results WHERE instance_id = ?').bind('probe-bootstrap-one').first('value')).toBe('durable');
  });

  it('rejects invalid webhook signatures rather than recording arbitrary payment events', async () => {
    const response = await call('/api/stripe/webhook', { method: 'POST', body: json({ id: 'evt_unverified', livemode: false }), headers: { 'stripe-signature': 'invalid' } });
    expect(response.status).toBe(400);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM probe_stripe_events').first<{ n: number }>())?.n).toBe(0);
  });
});
