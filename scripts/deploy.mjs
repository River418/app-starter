import { readFile, writeFile, mkdir } from "node:fs/promises";
import config from "../app.config.ts";
import { runTool } from "./process.mjs";
import { readWranglerConfig } from "./config.mjs";
import { setupBilling } from "./setup-billing.mjs";
import {
  validateDeployment,
  bucketNames,
  assertRemotePreset,
  assertAuthSettings,
} from "./deployment.mjs";

const environment = process.argv[2];
if (!["dev", "prod"].includes(environment))
  throw new Error("Usage: node scripts/deploy.mjs dev|prod [--prepare]");
const file = "wrangler.jsonc";
const wrangler = await readWranglerConfig(file);
const target = wrangler.env[environment];
const vars = target.vars;
if (process.argv.includes("--prepare")) {
  if (!/^[a-f0-9]{32}$/.test(target.account_id || ""))
    throw new Error("Set env target account_id before preparing resources");
  const name = `${config.slug}-${environment}`;
  target.name ||= name;
  const cliEnv = { CLOUDFLARE_ACCOUNT_ID: target.account_id };
  if (!target.d1_databases.length) {
    // Listing and resolving by the stable name also recovers a create/write interruption.
    let list = JSON.parse(
      await runTool("wrangler", ["d1", "list", "--json"], {
        capture: true,
        env: cliEnv,
      }),
    );
    if (!list.some((db) => db.name === name))
      await runTool("wrangler", ["d1", "create", name], { env: cliEnv });
    list = JSON.parse(
      await runTool("wrangler", ["d1", "list", "--json"], {
        capture: true,
        env: cliEnv,
      }),
    );
    const db = list.find((db) => db.name === name);
    if (!db) throw new Error("D1 mapping not found");
    target.d1_databases = [
      {
        binding: "DB",
        database_name: name,
        database_id: db.uuid,
        migrations_dir: "migrations",
      },
    ];
    await writeFile(file, `${JSON.stringify(wrangler, null, 2)}\n`);
  }
  if (!target.r2_buckets.length) {
    const list = await runTool("wrangler", ["r2", "bucket", "list"], {
      capture: true,
      env: cliEnv,
    });
    if (!bucketNames(list).includes(name))
      await runTool("wrangler", ["r2", "bucket", "create", name], {
        env: cliEnv,
      });
    target.r2_buckets = [{ binding: "FILES", bucket_name: name }];
    await writeFile(file, `${JSON.stringify(wrangler, null, 2)}\n`);
  }
  console.log(
    `Prepared ${environment}. Commit the non-secret resource mapping before deploying.`,
  );
  process.exit(0);
}
validateDeployment(config, environment, target);
await assertAuthSettings(config, target);
const other = wrangler.env[environment === "dev" ? "prod" : "dev"];
if (vars.SUPABASE_URL === other.vars.SUPABASE_URL)
  throw new Error("dev/prod must use separate Supabase projects");
if (
  target.d1_databases[0].database_id === other.d1_databases[0]?.database_id ||
  target.r2_buckets[0].bucket_name === other.r2_buckets[0]?.bucket_name
)
  throw new Error("dev/prod resources must be isolated");
// Until Phase 4 wires the live drain query, changing away from a deployed Agent fails closed.
await mkdir(".local", { recursive: true });
const stateFile = `.local/deployment-${environment}.json`;
let previous;
try {
  previous = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous?.preset === "agent" && config.preset === "web")
  throw new Error("Agent to web deployment requires the Phase 4 drain gate");
const cliEnv = {
  CLOUDFLARE_ENV: environment,
  CLOUDFLARE_ACCOUNT_ID: target.account_id,
};
await runTool("tsc", ["-p", "tsconfig.client.json"]);
await runTool("tsc", ["-p", "tsconfig.server.json"]);
await runTool("vite", ["build"], { env: cliEnv });
const built = JSON.parse(await readFile("dist/worker/wrangler.json", "utf8"));
if (built.d1_databases[0]?.database_id !== target.d1_databases[0].database_id)
  throw new Error("Build/migration D1 mismatch");
await assertRemotePreset(vars.APP_ORIGIN, config.preset);
// Confirm that the server-only secret exists before changing schema or deploying.
const secrets = JSON.parse(
  await runTool(
    "wrangler",
    ["secret", "list", "--config", "dist/worker/wrangler.json"],
    { capture: true, env: cliEnv },
  ),
);
if (!secrets.some((secret) => secret.name === "SUPABASE_SECRET_KEY"))
  throw new Error(
    "Set SUPABASE_SECRET_KEY using wrangler secret put --env before deployment",
  );
await runTool(
  "wrangler",
  [
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    "dist/worker/wrangler.json",
  ],
  { env: cliEnv },
);
await runTool("wrangler", ["deploy", "--config", "dist/worker/wrangler.json"], {
  env: cliEnv,
});
await writeFile(stateFile, JSON.stringify({ preset: config.preset }));
const health = await fetch(`${vars.APP_ORIGIN}/api/health`);
if (!health.ok || !(await health.json()).ok)
  throw new Error("Deployment health check failed");
if (config.billing?.enabled) await setupBilling(environment);
console.log(
  `Deployed ${vars.APP_ORIGIN}. Run npm run bootstrap:token -- ${environment} for first administrator.`,
);
