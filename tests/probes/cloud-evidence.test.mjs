import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTailFrames, redact, summarizeCpu } from '../../probes/shared/cloud.mjs';

test('parses complete Tail JSON frames across text and chunk boundaries without inventing CPU', () => {
  const raw = 'Connected\n' + JSON.stringify({ cpuTime: 15, wallTime: 80, outcome: 'ok', logs: ['quote { \\" }'] }, null, 2) + '\n' + JSON.stringify({ outcome: 'ok' }) + '\n{"unfinished":';
  const frames = parseTailFrames(raw);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].cpuTime, 15);
  assert.equal(frames[1].cpuTime, undefined);
  assert.throws(() => summarizeCpu(frames), /missing.*CPU/i);
});
test('redacts nested credentials from response evidence while retaining identifiers and status', () => {
  assert.deepEqual(redact({ token: 'private', user: { id: 'user-id' }, headers: { cookie: 'session', authorization: 'Bearer private' }, nested: [{ password: 'private', status: 200 }] }), { token: '[redacted]', user: { id: 'user-id' }, headers: { cookie: '[redacted]', authorization: '[redacted]' }, nested: [{ password: '[redacted]', status: 200 }] });
});
test('computes percentile from real finite invocation measurements only', () => {
  assert.deepEqual(summarizeCpu(Array.from({ length: 20 }, (_, i) => ({ cpuTime: i + 1, wallTime: 30, outcome: 'ok' }))), { count: 20, p50Ms: 10, p95Ms: 19, maxMs: 20, outcomes: ['ok'] });
});
