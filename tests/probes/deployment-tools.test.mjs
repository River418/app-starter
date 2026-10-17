import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertTarget, ensureSecrets, reconcileDatabase } from '../../probes/deployment/deploy.mjs';

const account = '9ea8bf0fbe8e0d352678d65f6b39fb4f';
const config = { name: 'cfas-probe-418-20261017-dev', vars: { PROBE_ENV: 'dev' }, d1_databases: [{ binding: 'DB', database_name: 'cfas-probe-418-20261017-dev' }], r2_buckets: [{ binding: 'FILES', bucket_name: 'cfas-probe-418-20261017-dev' }], workflows: [{ name: 'cfas-probe-418-20261017-dev-bootstrap' }] };

test('refuses the wrong account, environment and non-probe resources before mutation', () => {
  assert.doesNotThrow(() => assertTarget({ account, authenticatedAccounts: [account], environment: 'dev', config }));
  for (const change of [
    { account: 'other' }, { authenticatedAccounts: [] }, { environment: 'prod' },
    { config: { ...config, r2_buckets: [{ bucket_name: 'existing-product-data' }] } },
    { config: { ...config, name: 'cfas-probe-other-dev' } },
  ]) assert.throws(() => assertTarget({ account, authenticatedAccounts: [account], environment: 'dev', config, ...change }));
});

test('recovers a database created before its response or mapping was saved', () => {
  const binding = config.d1_databases[0];
  const remote = [{ name: binding.database_name, uuid: 'existing-id' }];
  assert.equal(reconcileDatabase(binding, remote), 'existing-id');
  assert.equal(reconcileDatabase(binding, []), null);
  assert.throws(() => reconcileDatabase({ ...binding, database_id: 'wrong-id' }, remote));
  assert.throws(() => reconcileDatabase({ ...binding, database_id: 'missing-id' }, []));
});

test('persists authentication secrets before deployment and never rotates them on retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cfas-secret-test-'));
  try {
    const file = join(root, 'dev', 'secrets.json');
    const first = await ensureSecrets(file);
    const second = await ensureSecrets(file);
    assert.deepEqual(second, first);
    assert.ok(first.PROBE_KEY.length >= 43);
    assert.ok(first.BETTER_AUTH_SECRET.length >= 43);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), first);
    assert.notEqual((await ensureSecrets(join(root, 'prod', 'secrets.json'))).BETTER_AUTH_SECRET, first.BETTER_AUTH_SECRET);
    await assert.rejects(ensureSecrets(join(root, 'lost', 'secrets.json'), { remoteSecretsConfigured: true }), /restore|missing/i);
    await writeFile(file, '{"PROBE_KEY":"incomplete"}');
    await assert.rejects(ensureSecrets(file), /incomplete|invalid/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
