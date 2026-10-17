import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { readPublicConfig } from "./config";
import type { AppEnv } from "./types";
import { bootstrap } from "./auth/bootstrap";
import { invitations } from "./auth/invitations";
import { administration } from "./administration/users";
import { requireIdentity } from "./auth/auth";
import { recordRoutes } from "../features/records/server/routes";
import { fileRoutes } from "./files/routes";

export const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    if (
      c.req.header("Origin") !== c.env.APP_ORIGIN ||
      c.req.header("Sec-Fetch-Site") === "cross-site"
    ) {
      return c.json({ error: "Origin forbidden" }, 403);
    }
  }
  await next();
});
app.use("/api/auth/*", bodyLimit({ maxSize: 16384 }));
app.use("/api/admin/*", bodyLimit({ maxSize: 16384 }));
app.get("/api/config", (c) => c.json(readPublicConfig(c.env)));
app.route("/api/auth", bootstrap);
app.route("/api/auth", invitations);
app.route("/api/admin", administration);
app.get("/api/session", async (c) => c.json(await requireIdentity(c)));
app.route("/api/records", recordRoutes);
app.route("/api", fileRoutes);
app.get("/api/health", async (c) => {
  const version = await c.env.DB.prepare(
    "SELECT max(version) AS version FROM schema_version",
  ).first<{ version: number }>();
  return c.json({
    ok: version?.version === 2,
    environment: c.env.APP_ENV,
    schemaVersion: version?.version,
  });
});
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  // Error details may contain provider payloads or credentials. Do not log them.
  console.error("Request failed", c.req.method, new URL(c.req.url).pathname);
  return c.json({ error: "Request failed" }, 500);
});
