import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
const auth = JSON.parse(readFileSync(".local/supabase-status.json", "utf8"));
if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_SANDBOX_ACCOUNT_ID)
  throw new Error(
    "Provide a dedicated test Sandbox key and STRIPE_SANDBOX_ACCOUNT_ID in ignored .dev.vars.dev",
  );
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          APP_ENV: "test",
          APP_ORIGIN: "http://localhost:5173",
          SUPABASE_URL: auth.API_URL,
          SUPABASE_PUBLISHABLE_KEY: auth.PUBLISHABLE_KEY || auth.ANON_KEY,
          SUPABASE_SECRET_KEY: auth.SECRET_KEY || auth.SERVICE_ROLE_KEY,
          STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
          STRIPE_SANDBOX_ACCOUNT_ID: process.env.STRIPE_SANDBOX_ACCOUNT_ID,
          STRIPE_WEBHOOK_SECRET: `whsec_${randomUUID()}`,
        },
      },
    })),
  ],
  test: {
    include: ["tests/sandbox/**/*.spec.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 30000,
  },
});
