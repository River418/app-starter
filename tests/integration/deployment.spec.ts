import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { app } from "../../src/server/app";

test("health admits the fully migrated schema and rejects an unsupported version", async () => {
  const health = async () =>
    (await (
      await app.request("http://localhost:5173/api/health", {}, env)
    ).json()) as any;
  expect(await health()).toMatchObject({ ok: true, schemaVersion: 5 });
  await env.DB.prepare("INSERT INTO schema_version VALUES(6)").run();
  expect(await health()).toMatchObject({ ok: false, schemaVersion: 6 });
});

test("unknown API returns JSON, config never contains secret keys", async () => {
  for (const path of ["/api", "/api/missing"]) {
    const response = await app.request(`http://localhost:5173${path}`, {}, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  }
  const response = await app.request(
    "http://localhost:5173/api/config",
    {},
    env,
  );
  const body = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    [
      "analytics",
      "authMode",
      "authReady",
      "billingEnabled",
      "environment",
      "maxFileBytes",
      "preset",
      "slug",
      "supabasePublishableKey",
      "supabaseUrl",
      "title",
    ].sort(),
  );
  expect(JSON.stringify(body)).not.toContain(env.SUPABASE_SECRET_KEY);
});
