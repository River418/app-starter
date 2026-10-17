import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadBrowserReport } from '../../probes/budget-protocol/browser-evidence.mjs';

test('missing or stale browser reporter output cannot reuse an older successful run', async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'cfas-browser-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = resolve(dir, 'run.json'), expected = { runId: 'current', sourceCommit: 'commit', model: 'model' };
  assert.equal(await loadBrowserReport(file, expected), null);
  await writeFile(file, JSON.stringify({ config: { metadata: { ...expected, runId: 'old' } }, suites: [] }));
  await assert.rejects(loadBrowserReport(file, expected), /different run/);
  await writeFile(file, JSON.stringify({ config: { metadata: expected }, suites: [] }));
  assert.deepEqual((await loadBrowserReport(file, expected)).config.metadata, expected);
});
