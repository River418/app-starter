import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './probes/deployment/wrangler.jsonc' },
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations('./probes/deployment/migrations'),
        PROBE_KEY: 'local-test-probe-key-not-a-cloud-credential',
        BETTER_AUTH_SECRET: 'local-auth-secret-at-least-32-characters-only-for-tests',
        STRIPE_WEBHOOK_SECRET: 'local-webhook-secret-used-only-by-deterministic-tests',
      },
    },
  }))],
  test: {
    include: ['probes/**/*.spec.ts'],
    setupFiles: ['./probes/setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
