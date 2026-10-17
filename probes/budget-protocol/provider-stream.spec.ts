import { expect, it } from 'vitest';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { modelFor } from './src/model.ts';
import { normalizeWorkersAIStream } from './src/workers-ai-stream.ts';

const wire = (value: unknown) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); c.close(); } });
it('keeps single dialects and removes only equal mirrored text', async () => {
  for (const value of [{ response: 'hello' }, { choices: [{ delta: { content: 'hello' } }] }]) {
    expect(JSON.parse((await new Response(normalizeWorkersAIStream(wire(value))).text()).slice(6).trim())).toEqual(value);
  }
  const value = { response: 'hello', choices: [{ delta: { content: 'hello' } }], usage: { total_tokens: 2 } };
  expect(JSON.parse((await new Response(normalizeWorkersAIStream(wire(value))).text()).slice(6).trim())).toEqual({ choices: value.choices, usage: value.usage });
});
it('refuses conflicting dialects instead of silently losing model output', async () => {
  await expect(new Response(normalizeWorkersAIStream(wire({ response: 'a', choices: [{ delta: { content: 'b' } }] }))).text()).rejects.toThrow(/Conflicting/);
});
it('propagates downstream cancellation to the original provider stream', async () => {
  let cancelled = false;
  const original = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":"hello"}\n\n')); }, cancel() { cancelled = true; } });
  const reader = normalizeWorkersAIStream(original).getReader(); await reader.read(); await reader.cancel();
  await expect.poll(() => cancelled).toBe(true);
});

it('parses mirrored native/OpenAI SSE once and forwards provider cancellation', async () => {
  const events = [
    { tool_calls: [{ index: 0, id: 'call-one', function: { name: 'writeSetting', arguments: '{"value":' } }], choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-one', function: { name: 'writeSetting', arguments: '{"value":' } }] } }] },
    { tool_calls: [{ index: 0, function: { arguments: '"approved"}' } }], choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"approved"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
  ];
  let providerSignal: unknown;
  const binding = { run: async (_model: unknown, _input: unknown, options: { signal?: AbortSignal }) => {
    providerSignal = options.signal;
    const wire = events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n';
    return new ReadableStream({ start(c) { const bytes = new TextEncoder().encode(wire); for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  } } as unknown as Ai;
  const controller = new AbortController();
  const result = streamText({ model: modelFor(binding), prompt: 'Write approved', tools: { writeSetting: tool({ inputSchema: z.object({ value: z.string() }) }) }, toolChoice: { type: 'tool', toolName: 'writeSetting' }, abortSignal: controller.signal, maxRetries: 0 });
  const parts = []; for await (const part of result.stream) parts.push(part);
  const call = parts.find(p => p.type === 'tool-call');
  expect(call && 'input' in call && call.input).toEqual({ value: 'approved' });
  expect(parts.some(p => p.type === 'tool-error')).toBe(false);
  controller.abort(); expect((providerSignal as AbortSignal).aborted).toBe(true);
});
