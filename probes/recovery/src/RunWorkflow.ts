import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { claimRun, completeRun, expireLeases, failRun, finishPreparation, readRun } from './store.ts';
import type { RecoveryEnvironment } from './outbox.ts';

const stepOptions = { retries: { limit: 1, delay: '1 second' as const, backoff: 'constant' as const }, timeout: '30 seconds' as const };

export class RecoveryProbeWorkflow extends WorkflowEntrypoint<RecoveryEnvironment, { runId: string }> {
  async run(event: WorkflowEvent<{ runId: string }>, step: WorkflowStep) {
    const id = event.payload.runId;
    try {
      await step.do('claim', stepOptions, async () => {
        const run = await readRun(this.env.DB, id);
        if (run?.state === 'queued') await claimRun(this.env.DB, id);
        return true;
      });
      let run = await readRun(this.env.DB, id);
      if (run?.mode === 'lease-expiry') await step.sleep('abandon-execution-lease', '45 seconds');
      await step.do('prepare', stepOptions, async () => {
        const current = await readRun(this.env.DB, id);
        if (!current || current.phase !== 'prepare' || current.state !== 'running') return;
        await this.env.DB.prepare("INSERT INTO recovery_usage (id, run_id, kind, step_key, units, cost_units) VALUES (?, ?, 'provider_attempt', 'prepare', 0, 1)").bind(crypto.randomUUID(), id).run();
        const count = await this.env.DB.prepare("SELECT count(*) AS n FROM recovery_usage WHERE run_id = ? AND kind = 'provider_attempt'").bind(id).first<number>('n');
        if (current.mode === 'always-fail' || (current.mode === 'retry-once' && count === 1)) throw Error('Deterministic provider failure');
        await finishPreparation(this.env.DB, current, current.approval === 1);
      });
      run = await readRun(this.env.DB, id);
      if (run?.state === 'waiting_approval') {
        if (run.mode === 'ack-lost' || run.mode === 'early-confirm') await step.sleep('before-wait', '2 seconds');
        try { await step.waitForEvent('approval-wakeup', { type: `confirm-${run.approval_id}`, timeout: '90 seconds' }); }
        catch { /* D1 approval is authoritative even if wakeup arrives after timeout. */ }
        run = await readRun(this.env.DB, id);
        if (run?.state === 'approved') await step.do('consume-approval', stepOptions, () => claimRun(this.env.DB, id));
        else await expireLeases(this.env.DB);
      } else if (run?.state === 'approved') await step.do('consume-approval', stepOptions, () => claimRun(this.env.DB, id));
      if (run?.mode === 'hold-commit') await step.sleep('before-commit', '2 seconds');
      await step.do('commit', stepOptions, async () => {
        const current = await readRun(this.env.DB, id);
        if (current) await completeRun(this.env.DB, current);
      });
      await expireLeases(this.env.DB);
      return { runId: id, state: (await readRun(this.env.DB, id))?.state };
    } catch {
      const run = await readRun(this.env.DB, id);
      if (run) await failRun(this.env.DB, id, run.owner_id);
      return { runId: id, state: (await readRun(this.env.DB, id))?.state };
    }
  }
}
