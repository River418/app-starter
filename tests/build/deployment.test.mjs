import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertRemotePreset,
  assertAuthSettings,
} from "../../scripts/deployment.mjs";
test("remote preset gate survives a clean checkout without local deployment state", async () => {
  await assert.rejects(
    assertRemotePreset("https://example.test", "web", async () =>
      Response.json({ preset: "agent" }),
    ),
    /drain/i,
  );
  await assert.rejects(
    assertRemotePreset(
      "https://example.test",
      "web",
      async () => new Response("", { status: 503 }),
    ),
    /current deployment/i,
  );
  await assertRemotePreset(
    "https://example.test",
    "web",
    async () => new Response("", { status: 404 }),
  );
});
test("auth preflight verifies actual provider settings, including confirmed email and disabled anonymous accounts", async () => {
  const target = {
    vars: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "public",
    },
  };
  const valid = {
    disable_signup: true,
    mailer_autoconfirm: false,
    external: { email: true, anonymous_users: false },
  };
  await assertAuthSettings({ authMode: "invite" }, target, async () =>
    Response.json(valid),
  );
  for (const bad of [
    { ...valid, disable_signup: false },
    { ...valid, mailer_autoconfirm: true },
    { ...valid, external: { email: true, anonymous_users: true } },
    {},
  ])
    await assert.rejects(
      assertAuthSettings({ authMode: "invite" }, target, async () =>
        Response.json(bad),
      ),
      /auth settings/i,
    );
});
