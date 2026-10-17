import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { promisify } from 'node:util';
import Stripe from 'stripe';
import { openProbe, root, sha256, startTail, summarizeCpu } from '../shared/cloud.mjs';
import { loadBrowserReport } from './browser-evidence.mjs';

const probe = await openProbe('dev', 'budget-protocol');
const tail = await startTail('dev', probe.evidenceDir), cases = [], diagnostic = [], threadIds = [];
const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const runId = crypto.randomUUID(), browserPath = resolve(probe.evidenceDir,'browser-results.json'), threadsPath = resolve(probe.evidenceDir,'thread-audits.json');
let browser;
let failure;
try {
  let browserError;
  try {
    const result = await promisify(execFile)(process.execPath, [resolve(root,'node_modules/playwright/cli.js'),'test','--config','probes/budget-protocol/playwright.config.ts'], { cwd: root, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CFAS_PROBE_URL: probe.base, CFAS_BROWSER_REPORT: browserPath, CFAS_PROBE_RUN_ID: runId, CFAS_PROBE_SOURCE_COMMIT: probe.sourceCommit, CFAS_PROBE_MODEL: model } });
    await writeFile(resolve(probe.evidenceDir,'browser-run.log'), result.stdout + result.stderr);
  } catch (error) { browserError = error; await writeFile(resolve(probe.evidenceDir,'browser-run.log'), (error.stdout ?? '') + (error.stderr ?? '')); }
  browser = await loadBrowserReport(browserPath, { runId, sourceCommit: probe.sourceCommit, model });
  const specs = [];
  const visit = suite => { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) visit(child); };
  for (const suite of browser?.suites ?? []) visit(suite);
  for (const [id, prefix] of [['text-stream','streams text'],['reload-history','streams text'],['read-tool','renders a real read'],['confirmed-write','asks for approval'],['rejected-write','denies a proposed'],['cancel','aborts the browser']]) {
    const spec = specs.find(x => x.title.startsWith(prefix));
    const test = spec?.tests?.[0], passed = test?.results?.length > 0 && test.results.every(x => x.status === 'passed');
    const ids = (test?.annotations ?? []).filter(x => x.type === 'cloud-thread').map(x => x.description);
    threadIds.push(...ids);
    cases.push({ id, status: passed ? 'pass' : 'fail', expected: spec?.title ?? prefix, actual: passed ? 'Real Chromium, Worker, D1 and Workers AI assertions passed' : `Browser status: ${test?.results?.map(x => x.status).join(',') ?? 'missing'}`, cloudIds: ids });
    console.log(`${id}: ${passed ? 'pass' : 'fail'}`);
  }
  const threads = [];
  for (const id of new Set(threadIds)) threads.push((await probe.request(`/api/probe/model/threads/${id}`)).data);
  await writeFile(threadsPath, JSON.stringify(threads,null,2));
  if (browserError) failure = Error('One or more real browser protocol assertions failed');
  try {
    const id = `probe-model-${crypto.randomUUID()}`;
    const response = await probe.request(`/api/probe/model/workflows/${id}`, { method: 'POST', body: { prompt: 'Reply with a short sentence about the Moon.' } });
    const result = await probe.waitFor(`/api/probe/model/workflows/${id}`, x => ['complete','errored','terminated'].includes(x.status.status));
    assert.equal(result.status.status,'complete'); assert.ok(result.result.text.length > 0); assert.equal(result.result.model,model);
    cases.push({ id:'model-workflow',status:'pass',expected:'A real Workflow step calls the selected real model and persists its result',actual:'Actual model text and provider usage persisted',cloudIds:[id,response.ray] });
    console.log('model-workflow: pass');
  } catch (error) { failure ??= error; cases.push({ id:'model-workflow',status:'fail',expected:'Actual model Workflow',actual:error.message,cloudIds:[] }); }
  // The selected Free plan is already known to fail the default password hash.
  // Collect a current-commit diagnostic rather than spending the free model
  // allowance on a full boundary benchmark for a rejected runtime baseline.
  for (let i = 0; i < 5; i++) {
    const account = { name:'CPU diagnostic',email:`cpu-${crypto.randomUUID()}@example.invalid`,password:'Validation-password-2026' };
    const registered = await probe.request('/api/probe/register',{method:'POST',body:account,auth:false,storeSession:false,acceptFailure:true});
    diagnostic.push({ operation:'registration',invocation:registered.invocation,status:registered.status,boundary:'typical',inputBytes:Buffer.byteLength(JSON.stringify(account)) });
    if (registered.status === 200) {
      const logged = await probe.request('/api/auth/sign-in/email',{method:'POST',body:{email:account.email,password:account.password},auth:false,storeSession:false,acceptFailure:true});
      diagnostic.push({ operation:'login',invocation:logged.invocation,status:logged.status,boundary:'typical' });
    }
    const session = await probe.request('/api/auth/get-session'); diagnostic.push({operation:'session',invocation:session.invocation,status:session.status,boundary:'typical'});
    const secrets = JSON.parse(await readFile(resolve(root,'.local/probes/dev/secrets.json'),'utf8'));
    const payload = JSON.stringify({id:`evt_crypto_${crypto.randomUUID()}`,type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_synthetic_signature_probe'}}});
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({payload,secret:secrets.STRIPE_WEBHOOK_SECRET});
    const webhook = await probe.request('/api/stripe/webhook',{method:'POST',body:payload,auth:false,headers:{'stripe-signature':signature}});
    diagnostic.push({operation:'webhook',invocation:webhook.invocation,status:webhook.status,boundary:'typical',inputBytes:Buffer.byteLength(payload)});
  }
} catch (error) { failure ??= error; console.error(error.message); }
finally {
  const trace = await tail.stop();
  const samples = diagnostic.map(sample => {
    const frame = trace.frames.find(f => f.event?.request?.headers?.['x-probe-invocation'] === sample.invocation);
    return { ...sample,cpuTimeMs:frame?.cpuTime,wallTimeMs:frame?.wallTime,outcome:frame?.outcome };
  });
  const metrics = [];
  for (const name of ['registration','login','session','webhook']) {
    const measured = samples.filter(s => s.operation === name && Number.isFinite(s.cpuTimeMs));
    if (!measured.length) continue;
    const stats = summarizeCpu(measured.map(s=>({cpuTime:s.cpuTimeMs,outcome:s.outcome})));
    metrics.push({name,limitMs:10,p95Ms:stats.p95Ms,maxMs:stats.maxMs,sampleCounts:{typical:measured.length,maximum:0,cold:0},outcomes:stats.outcomes});
  }
  const cpuExceeded = samples.some(s => s.cpuTimeMs > 10);
  cases.push({id:'cpu-typical',status:'fail',expected:'20 typical/max samples and cold request per operation, p95 <= 8ms and max <= 10ms on Free',actual:cpuExceeded?'Current real CPU again exceeds Free; diagnostic stopped after decisive failure':'A full passing CPU boundary benchmark was not performed on the rejected Free baseline',cloudIds:probe.journal.map(x=>x.ray).filter(Boolean)});
  cases.push({id:'cpu-max-input',status:'not_run',expected:'20 maximum-boundary samples per operation',actual:'Deferred: Free baseline is rejected and user explicitly deferred phase two; no Paid plan or weaker hash substituted',cloudIds:[]});
  const diagnosticPath = resolve(probe.evidenceDir,'cpu-diagnostic.json'); await writeFile(diagnosticPath,JSON.stringify(samples,null,2));
  const evidence = [{path:trace.path,sha256:sha256(await readFile(resolve(root,trace.path))),source:'cloudflare',role:'tail'},{path:relative(root,diagnosticPath).replaceAll('\\','/'),sha256:sha256(await readFile(diagnosticPath)),source:'cloudflare',role:'cpu-samples'}];
  if (browser) evidence.push({path:relative(root,browserPath).replaceAll('\\','/'),sha256:sha256(await readFile(browserPath)),source:'browser',role:'browser'},{path:relative(root,threadsPath).replaceAll('\\','/'),sha256:sha256(await readFile(threadsPath)),source:'cloudflare',role:'threads'});
  await probe.save({status:'fail',cases,model,runId,samplesPerBoundary:5,metrics,measurementScope:'Real browser/model/Workflow functional checks; current Free auth CPU diagnostic only, not a complete boundary benchmark',blockers:[failure?.message ?? 'Workers Free cannot meet the default password-hash CPU budget','Full CPU boundary benchmark not eligible; phase two deferred by user'],evidence});
}
process.exitCode=1; // Free is a measured/rejected baseline, never an implicit pass.
