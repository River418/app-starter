import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'browser.spec.ts', workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 },
  outputDir: '../../artifacts/browser-output',
  metadata: { runId: process.env.CFAS_PROBE_RUN_ID, sourceCommit: process.env.CFAS_PROBE_SOURCE_COMMIT, model: process.env.CFAS_PROBE_MODEL },
  reporter: [['list'], ['json', { outputFile: process.env.CFAS_BROWSER_REPORT ?? resolve(import.meta.dirname, '../../artifacts/browser-results.json') }]],
  use: { baseURL: process.env.CFAS_PROBE_URL ?? 'http://localhost:8787', channel: 'chromium', headless: true, trace: 'retain-on-failure' },
});
