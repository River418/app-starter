import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runTool } from "../../scripts/process.mjs";
import { readWranglerConfig } from "../../scripts/config.mjs";
test("real web bundle contains no server/agent code; build and migration share D1", async () => {
  await runTool("vite", ["build"], {
    capture: true,
    env: { CLOUDFLARE_ENV: "", APP_STARTER_WRANGLER_CONFIG: "" },
  });
  const modules = JSON.parse(
    await readFile(".local/client-modules.json", "utf8"),
  );
  assert(modules.some((id) => id.includes("/src/client/")));
  assert(
    !modules.some((id) =>
      /\/src\/server\/|\/features\/[^/]+\/server\/|\/probes\/|better-auth|drizzle-orm/.test(
        id,
      ),
    ),
  );
  const built = JSON.parse(await readFile("dist/worker/wrangler.json", "utf8"));
  const input = await readWranglerConfig();
  assert.equal(
    built.d1_databases[0].database_id,
    input.d1_databases[0].database_id,
  );
  assert(!built.workflows?.length);
  assert.equal(built.ai, undefined);
  const worker = await readFile("dist/worker/index.js", "utf8");
  assert(!worker.includes("WorkflowEntrypoint"));
  assert(!worker.includes("better-auth"));
});
