import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

export const root = resolve(import.meta.dirname, '../..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /^(token|password|cookie|set-cookie|authorization|.*secret.*|x-probe-key)$/i.test(key) ? '[redacted]' : redact(entry)]));
  return value;
}

export function parseTailFrames(raw) {
  const frames = [];
  let depth = 0, start = -1, quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { frames.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* non-JSON preamble */ } start = -1; }
  }
  return frames;
}

export function summarizeCpu(frames) {
  if (!frames.length || frames.some(x => !Number.isFinite(x.cpuTime) || x.cpuTime < 0)) throw Error('Missing real Cloudflare CPU measurements');
  const values = frames.map(x => x.cpuTime).sort((a, b) => a - b);
  const percentile = q => values[Math.ceil(q * values.length) - 1];
  return { count: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: values.at(-1), outcomes: [...new Set(frames.map(x => x.outcome))] };
}

export async function startTail(environment, evidenceDir) {
  const process = spawn(globalThis.process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'tail', '--config', resolve(root, 'probes/deployment/wrangler.jsonc'), '--env', environment, '--format', 'json'], { cwd: root, env: { ...globalThis.process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  let raw = '', stderr = '', closed = false;
  process.stdout.on('data', chunk => raw += chunk);
  process.stderr.on('data', chunk => stderr += chunk);
  process.on('close', () => closed = true);
  await pause(3000);
  if (closed) throw Error('Cloudflare Tail failed to connect');
  return {
    frames: () => parseTailFrames(raw),
    async stop() {
      await pause(1500);
      process.kill();
      await pause(150);
      await mkdir(evidenceDir, { recursive: true });
      const path = resolve(evidenceDir, 'tail-raw.jsonl');
      await writeFile(path, raw);
      await writeFile(resolve(evidenceDir, 'tail-stderr.log'), stderr);
      return { frames: parseTailFrames(raw), path: relative(root, path).replaceAll('\\', '/') };
    },
  };
}

export async function openProbe(environment = 'dev', gate = 'recovery') {
  if (!['dev', 'prod'].includes(environment)) throw Error('Invalid probe environment');
  if (git('status', '--porcelain')) throw Error('Commit probe code before cloud evidence');
  const sourceCommit = git('rev-parse', 'HEAD');
  const config = JSON.parse(await readFile(resolve(root, 'probes/deployment/wrangler.jsonc'), 'utf8'));
  const target = config.env[environment];
  if (!target.name.startsWith('cfas-probe-') || !target.name.endsWith(`-${environment}`)) throw Error('Disposable environment required');
  const secretDir = resolve(root, '.local/probes', environment);
  const secrets = JSON.parse(await readFile(resolve(secretDir, 'secrets.json'), 'utf8'));
  const base = target.vars.BETTER_AUTH_URL;
  const evidenceDir = resolve(root, 'artifacts', gate, environment, new Date().toISOString().replaceAll(/[:.]/g, '-'));
  await mkdir(evidenceDir, { recursive: true });
  let cookie = '';
  try { cookie = JSON.parse(await readFile(resolve(secretDir, 'session.json'), 'utf8')).cookie; } catch { /* first invocation */ }
  const journal = [];
  async function request(path, { method = 'GET', body, acceptFailure = false, auth = true, headers = {} } = {}) {
    const invocation = crypto.randomUUID();
    const response = await fetch(base + path, { method, headers: { 'x-probe-key': secrets.PROBE_KEY, 'x-probe-invocation': invocation, origin: base, ...(auth && cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    journal.push({ at: new Date().toISOString(), path, method, status: response.status, invocation, ray: response.headers.get('cf-ray'), response: redact(data) });
    if (!response.ok && !acceptFailure) throw Error(`Cloud probe ${method} ${path} returned ${response.status}`);
    const cookies = response.headers.getSetCookie();
    if (cookies.length && response.ok) { cookie = cookies.map(x => x.split(';')[0]).join('; '); await writeFile(resolve(secretDir, 'session.json'), JSON.stringify({ cookie })); }
    return { data, status: response.status, ray: response.headers.get('cf-ray'), invocation };
  }
  const existing = await request('/api/auth/get-session');
  if (!existing.data?.user) {
    const accountPath = resolve(secretDir, 'account.json');
    let account;
    try { account = JSON.parse(await readFile(accountPath, 'utf8')); }
    catch { account = { name: 'Cloud Validation Owner', email: `probe-${environment}@example.invalid`, password: randomBytes(24).toString('base64url') }; await writeFile(accountPath, JSON.stringify(account), { flag: 'wx', mode: 0o600 }); }
    const status = await request('/api/probe/status');
    const result = await request(status.data.initialized ? '/api/auth/sign-in/email' : '/api/probe/bootstrap', { method: 'POST', body: account, acceptFailure: true });
    if (result.status !== 200) throw Error('Probe login unavailable; restore its saved account/session, do not reset D1');
  }
  return { environment, base, sourceCommit, evidenceDir, target, request, journal,
    async waitFor(path, predicate, timeoutMs = 150000) {
      const start = Date.now();
      while (Date.now() - start <= timeoutMs) { const result = await request(path); if (predicate(result.data)) return result.data; await pause(1000); }
      throw Error(`Cloud probe timed out: ${path}`);
    },
    async save(gateReport) {
      const journalPath = resolve(evidenceDir, 'requests.json');
      await writeFile(journalPath, JSON.stringify(journal, null, 2));
      const report = { schemaVersion: 1, gate, mode: 'cloud', platformPlan: 'free', sourceCommit, cleanWorkingTree: true, lockfileSha256: sha256(await readFile(resolve(root, 'package-lock.json'))), versionsSha256: sha256(await readFile(resolve(root, 'probes/versions.json'))), environment: target.name, executedAt: new Date().toISOString(), ...gateReport, evidence: [...(gateReport.evidence ?? []), { path: relative(root, journalPath).replaceAll('\\', '/'), sha256: sha256(await readFile(journalPath)), source: 'cloudflare' }] };
      await mkdir(resolve(root, 'artifacts/gates'), { recursive: true });
      await writeFile(resolve(root, `artifacts/gates/${gate}.json`), JSON.stringify(report, null, 2) + '\n');
      return report;
    },
  };
}
