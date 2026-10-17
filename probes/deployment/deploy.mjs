import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const configPath = resolve(root, 'probes/deployment/wrangler.jsonc');

export function assertTarget({ account, authenticatedAccounts, environment, config }) {
  if (!/^[a-f0-9]{32}$/.test(account) || !authenticatedAccounts.includes(account)) throw Error('Wrong or unauthorized Cloudflare account');
  if (!['dev', 'prod'].includes(environment) || config.vars?.PROBE_ENV !== environment) throw Error('Wrong probe environment');
  if (!/^cfas-probe-[a-z0-9]+-\d{8}-(dev|prod)$/.test(config.name) || !config.name.endsWith(`-${environment}`)) throw Error('Invalid disposable probe name');
  for (const resource of [...config.d1_databases.map(x => x.database_name), ...config.r2_buckets.map(x => x.bucket_name)]) {
    if (resource !== config.name) throw Error('Resources must belong to this disposable probe');
  }
  for (const workflow of config.workflows) if (!workflow.name.startsWith(`${config.name}-`)) throw Error('Wrong Workflow environment');
}

export function reconcileDatabase(binding, databases) {
  const existing = databases.find(x => x.name === binding.database_name);
  if (binding.database_id && binding.database_id !== existing?.uuid) throw Error('Configured database missing or mapped to a different resource');
  return existing?.uuid ?? null;
}

export async function ensureSecrets(path) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const secrets = JSON.parse(await readFile(path, 'utf8'));
    if (![secrets.PROBE_KEY, secrets.BETTER_AUTH_SECRET].every(x => typeof x === 'string' && x.length >= 43)) throw Error('Persisted probe secrets are incomplete or invalid; refusing rotation');
    return secrets;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secrets = { PROBE_KEY: randomBytes(32).toString('base64url'), BETTER_AUTH_SECRET: randomBytes(32).toString('base64url') };
    try { await writeFile(path, JSON.stringify(secrets, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (writeError) { if (writeError.code === 'EEXIST') return ensureSecrets(path); throw writeError; }
    return secrets;
  }
}

export async function wrangler(args, { account, evidenceDir } = {}) {
  const { stdout, stderr } = await exec(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd: root, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}), CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(resolve(evidenceDir, `${Date.now()}-${args[0]}-${args[1] ?? 'command'}.log`), stdout + stderr);
  }
  return stdout;
}

export async function deployProbe({ account, environment, subdomain, prepare = false, title }) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const target = config.env[environment];
  if (!target) throw Error('Unknown probe environment');
  const who = JSON.parse(await wrangler(['whoami', '--json'], { account }));
  assertTarget({ account, authenticatedAccounts: who.accounts.map(x => x.id), environment, config: target });
  if (!/^[a-z0-9-]+$/.test(subdomain)) throw Error('An explicit workers.dev subdomain is required');
  const evidenceDir = resolve(root, 'artifacts/deployment', environment);
  const options = { account, evidenceDir };
  if (prepare) {
    let databases = JSON.parse(await wrangler(['d1', 'list', '--json'], options));
    let id = reconcileDatabase(target.d1_databases[0], databases);
    if (!id) {
      await wrangler(['d1', 'create', target.name, '--config', configPath, '--env', environment], options);
      databases = JSON.parse(await wrangler(['d1', 'list', '--json'], options));
      id = reconcileDatabase(target.d1_databases[0], databases);
      if (!id) throw Error('Created database not found; rerun preparation to reconcile');
    }
    target.d1_databases[0].database_id = id;
    const buckets = await wrangler(['r2', 'bucket', 'list'], options);
    const names = [...buckets.matchAll(/^name:\s+([^\s]+)\s*$/gm)].map(x => x[1]);
    if (!names.includes(target.name)) await wrangler(['r2', 'bucket', 'create', target.name], options);
    target.vars.BETTER_AUTH_URL = `https://${target.name}.${subdomain}.workers.dev`;
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`${environment}: isolated bindings prepared; commit the config before measuring cloud evidence`);
    return;
  }
  if (!target.d1_databases[0].database_id || target.vars.BETTER_AUTH_URL.includes('not-ready')) throw Error('Run --prepare and commit the resource mapping first');
  const { stdout: dirty } = await exec('git', ['status', '--porcelain'], { cwd: root });
  if (dirty.trim()) throw Error('Commit probe source before cloud deployment evidence');
  const secretsPath = resolve(root, '.local/probes', environment, 'secrets.json');
  await ensureSecrets(secretsPath);
  const common = ['--config', configPath, '--env', environment];
  await wrangler(['deploy', ...common, '--dry-run', '--autoconfig=false', '--outdir', resolve(root, '.local/build', environment)], options);
  await wrangler(['d1', 'migrations', 'apply', 'DB', ...common, '--remote', '--yes'], options);
  const output = await wrangler(['deploy', ...common, '--autoconfig=false', '--secrets-file', secretsPath, ...(title ? ['--var', `PROBE_TITLE:${title}`] : [])], options);
  console.log(output.split('\n').filter(x => /workers.dev|Version ID|Workflow|Uploaded|Deployed/.test(x)).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  try {
    if (!args.includes('--account') || !args.includes('--environment') || !args.includes('--subdomain')) throw Error('Required: --account <id> --environment dev|prod --subdomain <workers.dev subdomain> [--prepare]');
    await deployProbe({ account: option('--account'), environment: option('--environment'), subdomain: option('--subdomain'), prepare: args.includes('--prepare'), title: args.includes('--title') ? option('--title') : undefined });
  } catch (error) { console.error(error.message); if (error.stdout) console.error(error.stdout); if (error.stderr) console.error(error.stderr); process.exitCode = 1; }
}
