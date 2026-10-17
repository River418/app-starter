import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, tool, type LanguageModel, type UIMessage } from 'ai';
import { z } from 'zod';

export interface ChatThread { id: string; owner_id: string; scenario: string; state: string; version: number; messages: UIMessage[]; value: string; writes: number; run_nonce: string | null; model_calls: number }
interface ThreadRow extends Omit<ChatThread, 'messages' | 'model_calls'> { messages_json: string }
interface Approval { id: string; tool_call_id: string; input_json: string; decision: number | null }
const controllers = new Map<string, AbortController>();
const json = (body: unknown, status = 200) => Response.json(body, { status });
const pendingSchema = z.object({ type: z.literal('tool-writeSetting'), state: z.literal('approval-requested'), toolCallId: z.string(), input: z.object({ value: z.string().max(100) }), approval: z.object({ id: z.string() }) });

export async function createChatThread(db: D1Database, owner: string, scenario: string): Promise<ChatThread> {
  if (!['text','read','write','cancel'].includes(scenario)) throw Error('Invalid scenario');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO model_threads (id, owner_id, scenario) VALUES (?, ?, ?)').bind(id, owner, scenario).run();
  return (await loadChatThread(db, owner, id))!;
}
export async function loadChatThread(db: D1Database, owner: string, id: string): Promise<ChatThread | null> {
  const row = await db.prepare('SELECT * FROM model_threads WHERE id = ? AND owner_id = ?').bind(id, owner).first<ThreadRow>();
  if (!row) return null;
  const count = await db.prepare('SELECT coalesce(sum(model_calls),0) AS n FROM model_runs WHERE thread_id = ?').bind(id).first<number>('n');
  const { messages_json, ...thread } = row;
  return { ...thread, messages: JSON.parse(messages_json), model_calls: count ?? 0 };
}
export async function cancelChat(db: D1Database, owner: string, id: string): Promise<void> {
  const thread = await loadChatThread(db, owner, id);
  if (!thread) return;
  await db.batch([
    db.prepare("UPDATE model_threads SET state = 'cancelled', version = version + 1 WHERE id = ? AND owner_id = ? AND run_nonce = ? AND state IN ('running','awaiting_approval')").bind(id, owner, thread.run_nonce),
    db.prepare("UPDATE model_runs SET state = 'cancelled', input_tokens = NULL, output_tokens = NULL WHERE id = ? AND state = 'running' AND EXISTS (SELECT 1 FROM model_threads WHERE id = ? AND run_nonce = ? AND state = 'cancelled')").bind(thread.run_nonce, id, thread.run_nonce),
  ]);
  if (thread.run_nonce) controllers.get(thread.run_nonce)?.abort();
}

export async function runChat(env: { DB: D1Database }, owner: string, id: string, request: Request, model: LanguageModel, defer: (work: Promise<unknown>) => void = work => { void work.catch(() => console.warn('Probe abort audit pending')); }): Promise<Response> {
  const db = env.DB, thread = await loadChatThread(db, owner, id);
  if (!thread) return json({ error: 'Not found' }, 404);
  if (!['idle','done','awaiting_approval'].includes(thread.state)) return json({ error: 'Run cannot reopen' }, 409);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16384) return json({ error: 'Probe input exceeds 16 KiB' }, 413);
  let submitted: { messages?: UIMessage[] };
  try { submitted = JSON.parse(raw); } catch { return json({ error: 'Invalid messages' }, 400); }
  if (!Array.isArray(submitted.messages)) return json({ error: 'Messages required' }, 400);
  const nonce = crypto.randomUUID();
  let messages = structuredClone(thread.messages), approval: Approval | null = null, approved = false;
  const resume = thread.state === 'awaiting_approval';
  if (resume) {
    approval = await db.prepare('SELECT id, tool_call_id, input_json, decision FROM model_approvals WHERE thread_id = ? AND decision IS NULL').bind(id).first<Approval>();
    if (!approval) return json({ error: 'No pending approval' }, 409);
    const offered = submitted.messages.flatMap(m => Array.isArray(m.parts) ? m.parts : []).find(p => 'approval' in p && (p.approval as { id?: string })?.id === approval!.id) as unknown as { type: string; state: string; toolCallId: string; input: unknown; approval: { approved?: unknown } } | undefined;
    if (!offered || offered.type !== 'tool-writeSetting' || offered.state !== 'approval-responded' || offered.toolCallId !== approval.tool_call_id || JSON.stringify(offered.input) !== approval.input_json || typeof offered.approval.approved !== 'boolean') return json({ error: 'Approval does not match the saved proposal' }, 409);
    approved = offered.approval.approved;
    for (const part of messages.at(-1)!.parts) if (part.type === 'tool-writeSetting' && 'approval' in part && (part.approval as { id: string }).id === approval.id) {
      const saved = part as unknown as { state: string; approval: { id: string; approved: boolean } };
      saved.state = 'approval-responded'; saved.approval = { ...saved.approval, approved };
    }
  } else {
    const last = submitted.messages.at(-1);
    if (!last || last.role !== 'user' || !Array.isArray(last.parts) || last.parts.some(p => p.type !== 'text') || !/^[a-zA-Z0-9_-]{1,100}$/.test(last.id) || messages.some(m => m.id === last.id)) return json({ error: 'A new text message is required' }, 409);
    const text = last.parts.map(p => p.type === 'text' ? p.text : '').join('');
    if (!text || new TextEncoder().encode(text).byteLength > 2048) return json({ error: 'Message exceeds 2 KiB' }, 413);
    messages.push({ id: last.id, role: 'user', parts: [{ type: 'text', text }] });
  }
  if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > 16384) return json({ error: 'Probe history exceeds 16 KiB' }, 413);
  const claim = await db.batch([
    db.prepare(`INSERT INTO model_runs (id, thread_id) SELECT ?, id FROM model_threads WHERE id = ? AND owner_id = ? AND version = ? AND state = ?
      AND (SELECT count(*) FROM model_runs) < 40
      ${resume ? 'AND EXISTS (SELECT 1 FROM model_approvals WHERE id = ? AND thread_id = model_threads.id AND decision IS NULL AND expires_at > unixepoch())' : ''}`)
      .bind(nonce, id, owner, thread.version, thread.state, ...(resume ? [approval!.id] : [])),
    ...(resume ? [db.prepare('UPDATE model_approvals SET decision = ?, decision_token = ? WHERE id = ? AND EXISTS (SELECT 1 FROM model_runs WHERE id = ?)').bind(Number(approved), nonce, approval!.id, nonce)] : []),
    db.prepare("UPDATE model_threads SET state = 'running', version = version + 1, run_nonce = ?, messages_json = ? WHERE id = ? AND EXISTS (SELECT 1 FROM model_runs WHERE id = ?)").bind(nonce, JSON.stringify(messages), id, nonce),
  ]);
  if (claim[0].meta.changes !== 1) return json({ error: 'Run changed, approval expired or probe call budget exhausted' }, 409);
  const streamStarted = performance.now();
  let textDeltas = 0, firstDeltaMs: number | null = null, lastDeltaMs: number | null = null;
  const controller = new AbortController(); controllers.set(nonce, controller);
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(30000)]);
  request.signal.addEventListener('abort', () => { controller.abort(); defer(db.batch([
    db.prepare("UPDATE model_threads SET state = 'cancelled', version = version + 1 WHERE id = ? AND run_nonce = ? AND state = 'running'").bind(id, nonce),
    db.prepare("UPDATE model_runs SET request_aborted = 1, state = CASE WHEN state = 'running' THEN 'cancelled' ELSE state END, input_tokens = CASE WHEN state = 'running' THEN NULL ELSE input_tokens END, output_tokens = CASE WHEN state = 'running' THEN NULL ELSE output_tokens END WHERE id = ?").bind(nonce),
  ])); }, { once: true });
  signal.addEventListener('abort', () => defer(db.prepare("UPDATE model_runs SET provider_aborted = 1 WHERE id = ? AND state IN ('running','cancelled')").bind(nonce).run()), { once: true });
  const tools = {
    readSetting: tool({ description: 'Read the current setting of this owned validation thread.', inputSchema: z.object({}), execute: async () => {
      const current = await loadChatThread(db, owner, id); if (!current) throw Error('Thread unavailable');
      return { value: current.value, writes: current.writes };
    } }),
    writeSetting: tool({ description: 'Change the current setting. Always requires explicit user approval.', inputSchema: z.object({ value: z.string().min(1).max(100) }), execute: async ({ value }, options) => {
      const execution = crypto.randomUUID();
      const result = await db.batch([
        db.prepare(`UPDATE model_approvals SET executed = 1, execution_token = ? WHERE thread_id = ? AND tool_call_id = ? AND input_json = ? AND decision = 1 AND decision_token = ? AND executed = 0 AND expires_at > unixepoch()
          AND EXISTS (SELECT 1 FROM model_threads WHERE id = ? AND run_nonce = ? AND state = 'running')`).bind(execution, id, options.toolCallId, JSON.stringify({ value }), nonce, id, nonce),
        db.prepare('UPDATE model_threads SET value = ?, writes = writes + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM model_approvals WHERE execution_token = ? AND thread_id = ?)').bind(value, id, execution, id),
      ]);
      if (result[0].meta.changes !== 1) throw Error('Write approval unavailable or already consumed');
      return { value, writes: (await loadChatThread(db, owner, id))!.writes };
    } }),
  };
  const result = streamText({
    model, messages: await convertToModelMessages(messages, { tools }),
    system: thread.scenario === 'cancel' ? 'Write a long numbered list of 200 facts about astronomy. Keep generating until asked to stop.' : 'You are a validation assistant. Use only the provided tools. After a tool result, explain it briefly. Never retry a denied action. For text, write two short sentences.',
    tools, toolApproval: { writeSetting: 'user-approval' }, stopWhen: isStepCount(3), maxOutputTokens: thread.scenario === 'cancel' ? 512 : 128, maxRetries: 0, abortSignal: signal,
    prepareStep: ({ steps }) => !resume && steps.length === 0 && ['read','write'].includes(thread.scenario) ? { toolChoice: { type: 'tool', toolName: thread.scenario === 'read' ? 'readSetting' : 'writeSetting' } } : { activeTools: [] },
    onStepEnd: async step => { await db.prepare('UPDATE model_runs SET model_calls = model_calls + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?').bind(step.usage.inputTokens ?? null, step.usage.outputTokens ?? null, nonce).run(); },
  });
  const auditedStream = result.stream.pipeThrough(new TransformStream({ transform(part, target) {
    if (part.type === 'text-delta') { textDeltas++; firstDeltaMs ??= performance.now() - streamStarted; lastDeltaMs = performance.now() - streamStarted; }
    target.enqueue(part);
  } }));
  return createUIMessageStreamResponse({ stream: toUIMessageStream({
    stream: auditedStream, tools, originalMessages: messages, generateMessageId: () => crypto.randomUUID(),
    onError: error => { console.warn('Model probe error', error instanceof Error ? error.name : 'unknown'); return 'Model probe failed'; },
    onEnd: async end => {
      try {
        const proposals = end.responseMessage.parts.map(p => pendingSchema.safeParse(p)).filter(p => p.success).map(p => p.data!);
        const state = end.isAborted || end.isCancelled ? 'cancelled' : end.outcome.status === 'failed' ? 'failed' : proposals.length ? 'awaiting_approval' : 'done';
        await db.batch([
          ...proposals.map(p => db.prepare(`INSERT INTO model_approvals (id, thread_id, tool_call_id, input_json, expires_at) SELECT ?, id, ?, ?, unixepoch() + 120 FROM model_threads WHERE id = ? AND run_nonce = ? AND state = 'running' ON CONFLICT(id) DO NOTHING`).bind(p.approval.id, p.toolCallId, JSON.stringify(p.input), id, nonce)),
          db.prepare('UPDATE model_threads SET state = ?, messages_json = ?, version = version + 1 WHERE id = ? AND run_nonce = ? AND state = \'running\'').bind(state, JSON.stringify(end.messages), id, nonce),
          db.prepare("UPDATE model_runs SET state = CASE WHEN state = 'cancelled' THEN state ELSE ? END, text_deltas = ?, first_delta_ms = ?, last_delta_ms = ? WHERE id = ?").bind(state, textDeltas, firstDeltaMs, lastDeltaMs, nonce),
        ]);
      } finally { controllers.delete(nonce); }
    },
  }) });
}
