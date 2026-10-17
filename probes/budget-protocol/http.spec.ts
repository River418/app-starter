import { env, exports as worker } from 'cloudflare:workers';
import { expect, it } from 'vitest';

const origin = 'http://probe.local';
async function call(path: string, body?: unknown, cookie?: string) {
  return worker.default.fetch(new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'x-probe-key': env.PROBE_KEY, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
it('persists a probe thread through the real authenticated API and hides it from another user', async () => {
  const user = async (email: string) => {
    const registered = await call('/api/probe/register', { name: 'Protocol Owner', email, password: 'Validation-password-2026' });
    expect(registered.status).toBe(200);
    return registered.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
  };
  expect((await call('/api/probe/model/threads', { scenario: 'text' })).status).toBe(401);
  const owner = await user('protocol-owner@example.invalid');
  const created = await call('/api/probe/model/threads', { scenario: 'text' }, owner);
  expect(created.status).toBe(201);
  const thread = await created.json() as { thread: { id: string } };
  const loaded = await call(`/api/probe/model/threads/${thread.thread.id}`, undefined, owner);
  expect(loaded.status).toBe(200);
  expect((await loaded.json() as { thread: { messages: unknown[] } }).thread.messages).toEqual([]);
  const foreign = await user('protocol-foreign@example.invalid');
  expect((await call(`/api/probe/model/threads/${thread.thread.id}`, undefined, foreign)).status).toBe(404);
});
