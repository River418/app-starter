import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { generateText } from 'ai';
import type { ProbeEnvironment } from '../../deployment/src/index.ts';
import { modelFor } from './model.ts';

export class ModelProbeWorkflow extends WorkflowEntrypoint<ProbeEnvironment, { threadId: string; prompt: string }> {
  async run(event: WorkflowEvent<{ threadId: string; prompt: string }>, step: WorkflowStep) {
    return step.do('actual-model-call', { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '45 seconds' }, async () => {
      const previous = await this.env.DB.prepare('SELECT value FROM probe_workflow_results WHERE instance_id = ?').bind(event.instanceId).first<string>('value');
      if (previous) return JSON.parse(previous);
      const reserved = await this.env.DB.prepare('INSERT INTO model_runs (id, thread_id) SELECT ?, ? WHERE (SELECT count(*) FROM model_runs) < 40 ON CONFLICT(id) DO NOTHING').bind(event.instanceId, event.payload.threadId).run();
      if (reserved.meta.changes !== 1) throw Error('Model probe budget exhausted or prior attempt outcome unknown');
      const result = await generateText({ model: modelFor(this.env.AI), prompt: event.payload.prompt, maxOutputTokens: 32, maxRetries: 0, abortSignal: AbortSignal.timeout(30000) });
      const output = { text: result.text, usage: result.usage, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' };
      await this.env.DB.batch([
        this.env.DB.prepare('INSERT INTO probe_workflow_results (instance_id, value) VALUES (?, ?)').bind(event.instanceId, JSON.stringify(output)),
        this.env.DB.prepare("UPDATE model_runs SET state = 'done', model_calls = 1, input_tokens = ?, output_tokens = ? WHERE id = ?").bind(result.usage.inputTokens ?? null, result.usage.outputTokens ?? null, event.instanceId),
      ]);
      return output;
    });
  }
}
