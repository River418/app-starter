import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { UIMessage } from 'ai';
import { createChatThread, loadChatThread, runChat, cancelChat } from './src/chat.ts';

const usage = { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 4, text: 4, reasoning: 0 } };
const textParts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text-1' }, { type: 'text-delta', id: 'text-1', delta: 'Hello ' }, { type: 'text-delta', id: 'text-1', delta: 'world' }, { type: 'text-end', id: 'text-1' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }];
const response = (parts: LanguageModelV4StreamPart[]) => ({ stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } }) });
const call = (toolName: string, input: object) => response([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: `${toolName}-one`, toolName, input: JSON.stringify(input) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }]);
const message = (text: string): UIMessage => ({ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] });
async function send(id: string, messages: UIMessage[], model: MockLanguageModelV4, signal?: AbortSignal) {
  return runChat(env, 'owner-a', id, new Request('http://probe.local/api/probe/chat/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), signal }), model);
}
async function consume(result: Response) {
  expect(result.status).toBe(200);
  return (await result.text()).split('\n').filter(x => x.startsWith('data: {')).map(x => JSON.parse(x.slice(6)));
}
function answer(messages: UIMessage[], approved: boolean) {
  const copy = structuredClone(messages);
  for (const part of copy.at(-1)!.parts) if (part.type === 'tool-writeSetting' && 'approval' in part) {
    const value = part as unknown as { state: string; approval: { approved?: boolean } };
    value.state = 'approval-responded'; value.approval.approved = approved;
  }
  return copy;
}

describe('AI SDK7 protocol with real D1 and a deterministic model adapter', () => {
  it('streams multiple text parts and reloads complete history without another generation', async () => {
    const thread = await createChatThread(env.DB, 'owner-a', 'text');
    const model = new MockLanguageModelV4({ doStream: response(textParts) });
    const chunks = await consume(await send(thread.id, [message('Say hello')], model));
    expect(chunks.filter(x => x.type === 'text-delta')).toHaveLength(2);
    const loaded = await loadChatThread(env.DB, 'owner-a', thread.id);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[1].parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Hello world' }));
    expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.messages).toEqual(loaded!.messages);
    expect(await loadChatThread(env.DB, 'owner-b', thread.id)).toBeNull();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(await env.DB.prepare('SELECT text_deltas FROM model_runs WHERE thread_id = ?').bind(thread.id).first('text_deltas')).toBe(2);
  });

  it('runs a real server-side read tool and continues with its result', async () => {
    const thread = await createChatThread(env.DB, 'owner-a', 'read');
    const model = new MockLanguageModelV4({ doStream: [call('readSetting', {}), response(textParts)] });
    const chunks = await consume(await send(thread.id, [message('Read current setting')], model));
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-output-available', toolCallId: 'readSetting-one', output: { value: 'initial', writes: 0 } }));
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('persists a proposal before approval and executes an approved write exactly once', async () => {
    const thread = await createChatThread(env.DB, 'owner-a', 'write');
    const proposal = new MockLanguageModelV4({ doStream: call('writeSetting', { value: 'approved-value' }) });
    const chunks = await consume(await send(thread.id, [message('Change the setting')], proposal));
    expect(chunks.some(x => x.type === 'tool-approval-request')).toBe(true);
    const waiting = (await loadChatThread(env.DB, 'owner-a', thread.id))!;
    expect(waiting.state).toBe('awaiting_approval'); expect(waiting.writes).toBe(0);
    const messages = answer(waiting.messages, true);
    await consume(await send(thread.id, messages, new MockLanguageModelV4({ doStream: response(textParts) })));
    const done = (await loadChatThread(env.DB, 'owner-a', thread.id))!;
    expect(done.writes).toBe(1); expect(done.value).toBe('approved-value');
    expect((await send(thread.id, messages, new MockLanguageModelV4())).status).toBe(409);
    expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.writes).toBe(1);
  });

  it('does not execute a denied write and refuses tampered canonical tool arguments', async () => {
    for (const tamper of [true, false]) {
      const thread = await createChatThread(env.DB, 'owner-a', 'write');
      await consume(await send(thread.id, [message('Change setting')], new MockLanguageModelV4({ doStream: call('writeSetting', { value: 'proposed' }) })));
      const waiting = (await loadChatThread(env.DB, 'owner-a', thread.id))!;
      const messages = answer(waiting.messages, tamper);
      if (tamper) {
        const part = messages.at(-1)!.parts.find(p => p.type === 'tool-writeSetting') as unknown as { input: { value: string } };
        part.input.value = 'tampered';
        expect((await send(thread.id, messages, new MockLanguageModelV4())).status).toBe(409);
      } else await consume(await send(thread.id, messages, new MockLanguageModelV4({ doStream: response(textParts) })));
      expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.writes).toBe(0);
    }
  });

  it('expires an unconfirmed proposal on reload and rejects every later decision', async () => {
    const thread = await createChatThread(env.DB, 'owner-a', 'write');
    await consume(await send(thread.id, [message('Change setting')], new MockLanguageModelV4({ doStream: call('writeSetting', { value: 'expired' }) })));
    const pending = (await loadChatThread(env.DB, 'owner-a', thread.id))!;
    await env.DB.prepare('UPDATE model_approvals SET expires_at = unixepoch() - 1 WHERE thread_id = ?').bind(thread.id).run();
    expect(await loadChatThread(env.DB, 'owner-b', thread.id)).toBeNull();
    expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.state).toBe('expired');
    for (const approved of [true, false]) expect((await send(thread.id, answer(pending.messages, approved), new MockLanguageModelV4())).status).toBe(409);
    expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.writes).toBe(0);
    expect(await env.DB.prepare('SELECT state FROM model_runs WHERE thread_id = ?').bind(thread.id).first('state')).toBe('expired');
  });

  it('cancels the request and provider signal without reopening the persisted run', async () => {
    const thread = await createChatThread(env.DB, 'owner-a', 'cancel');
    let providerSignal: AbortSignal | undefined;
    const model = new MockLanguageModelV4({ doStream: async options => {
      providerSignal = options.abortSignal;
      return { stream: new ReadableStream({ start(controller) { for (const part of textParts.slice(0, 4)) controller.enqueue(part); options.abortSignal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError'))); } }) };
    } });
    const abort = new AbortController();
    const result = await send(thread.id, [message('Long response')], model, abort.signal);
    const reader = result.body!.getReader();
    await reader.read(); await reader.read();
    await cancelChat(env.DB, 'owner-a', thread.id);
    abort.abort(); await reader.cancel();
    expect(providerSignal?.aborted).toBe(true);
    expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.state).toBe('cancelled');
    expect((await send(thread.id, [message('late')], new MockLanguageModelV4())).status).toBe(409);
  });

  it('keeps a completed model audit terminal when its old request disconnects later', async () => {
    const thread = await createChatThread(env.DB, 'owner-a', 'text');
    const abort = new AbortController(), deferred: Promise<unknown>[] = [];
    const result = await runChat(env, 'owner-a', thread.id, new Request('http://probe.local/chat', { method: 'POST', body: JSON.stringify({ messages: [message('Hello')] }), signal: abort.signal }), new MockLanguageModelV4({ doStream: response(textParts) }), work => { deferred.push(work); });
    await consume(result); abort.abort(); await Promise.all(deferred);
    expect((await loadChatThread(env.DB, 'owner-a', thread.id))!.state).toBe('done');
    expect(await env.DB.prepare('SELECT state FROM model_runs WHERE thread_id = ?').bind(thread.id).first('state')).toBe('done');
  });
});
