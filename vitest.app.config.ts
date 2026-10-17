import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

let auth: Record<string, string> = {};
try {
  auth = JSON.parse(readFileSync(".local/supabase-status.json", "utf8"));
} catch {
  /* deployment test can run without auth */
}
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
          SUPABASE_URL: auth.API_URL || "",
          SUPABASE_PUBLISHABLE_KEY: auth.ANON_KEY || auth.PUBLISHABLE_KEY || "",
          SUPABASE_SECRET_KEY: auth.SERVICE_ROLE_KEY || auth.SECRET_KEY || "",
        },
      },
    })),
  ],
  test: {
    include: ["tests/integration/**/*.spec.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
