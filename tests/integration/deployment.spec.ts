import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { app } from "../../src/server/app";

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
      "authMode",
      "authReady",
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
