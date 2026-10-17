import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBoundaries } from "../../scripts/boundaries.mjs";
import {
  assertPresetTransition,
  validateDeployment,
  bucketNames,
} from "../../scripts/deployment.mjs";

test("client cannot import server, including through shared re-exports", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-starter-boundaries-"));
  try {
    for (const name of ["client", "shared", "server"])
      await mkdir(join(root, "src", name), { recursive: true });
    await writeFile(
      join(root, "src/client/main.ts"),
      "import { secret } from '../shared/leak';",
    );
    await writeFile(
      join(root, "src/shared/leak.ts"),
      "export { secret } from '../server/private';",
    );
    await writeFile(
      join(root, "src/server/private.ts"),
      "export const secret = 'never ship';",
    );
    assert.throws(() => checkBoundaries(root), /boundary/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("real application import boundaries pass", () =>
  assert.doesNotThrow(() => checkBoundaries(process.cwd())));
test("native Wrangler aligned bucket list is parsed exactly", () =>
  assert.deepEqual(
    bucketNames(
      "name:           demo-dev\ncreation_date:  2026-10-17\n\nname:           demo-dev-other\r\n",
    ),
    ["demo-dev", "demo-dev-other"],
  ));
test("agent to web refuses active runs, outbox or unsettled reservations", async () => {
  for (const field of ["activeRuns", "outbox", "unsettled"]) {
    await assert.rejects(
      assertPresetTransition({
        previous: "agent",
        next: "web",
        acceptingRuns: false,
        readState: async () => ({
          activeRuns: 0,
          outbox: 0,
          unsettled: 0,
          [field]: 1,
        }),
      }),
      /drain/i,
    );
  }
  await assert.rejects(
    assertPresetTransition({
      previous: "agent",
      next: "web",
      acceptingRuns: true,
      readState: async () => ({ activeRuns: 0, outbox: 0, unsettled: 0 }),
    }),
    /accept/i,
  );
  await assertPresetTransition({
    previous: "agent",
    next: "web",
    acceptingRuns: false,
    readState: async () => ({ activeRuns: 0, outbox: 0, unsettled: 0 }),
  });
});
test("deployment refuses cross-environment identity and incomplete public auth", () => {
  const config = {
    slug: "demo",
    title: "Demo",
    preset: "web",
    authMode: "invite",
    maxFileBytes: 10485760,
  };
  const env = {
    account_id: "a".repeat(32),
    d1_databases: [
      { binding: "DB", database_id: "d", database_name: "demo-dev" },
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: "demo-dev" }],
    vars: {
      APP_ENV: "dev",
      APP_ORIGIN: "https://demo.example",
      SUPABASE_URL: "https://a.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      AUTH_SETTINGS_CONFIRMED: "invite",
    },
  };
  assert.doesNotThrow(() => validateDeployment(config, "dev", env));
  assert.throws(() => validateDeployment(config, "prod", env), /environment/i);
  assert.throws(
    () => validateDeployment({ ...config, authMode: "public" }, "dev", env),
    /auth/i,
  );
});
