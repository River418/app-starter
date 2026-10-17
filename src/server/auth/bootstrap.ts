import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { adminAuth } from "./auth";
import { sha256 } from "./crypto";

export const bootstrap = new Hono<AppEnv>();
bootstrap.get("/status", async (c) => {
  const admin = await c.env.DB.prepare(
    "SELECT user_id FROM members WHERE role='admin' LIMIT 1",
  ).first();
  return c.json({ initialized: Boolean(admin) });
});
bootstrap.post("/bootstrap", async (c) => {
  const input = z
    .object({
      token: z.string().min(12).max(200),
      email: z.email().transform((v) => v.trim().toLowerCase()),
      password: z.string().min(12).max(128),
    })
    .safeParse(await c.req.json());
  if (!input.success) return c.json({ error: "Invalid bootstrap input" }, 400);
  const { token, email, password } = input.data;
  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    "SELECT * FROM bootstrap WHERE id=1",
  ).first<{
    token_hash: string;
    expires_at: number;
    state: string;
    user_id: string;
    email: string;
    operation_id: string;
  }>();
  if (!row || row.token_hash !== hash || row.expires_at < Date.now())
    return c.json({ error: "Bootstrap token expired or invalid" }, 410);
  if (row.state === "complete")
    return c.json({ error: "Already initialized" }, 409);
  if (row.state === "ready") {
    await c.env.DB.prepare(
      "UPDATE bootstrap SET state='claimed',user_id=?,email=?,operation_id=? WHERE id=1 AND state='ready' AND token_hash=? AND expires_at>?",
    )
      .bind(crypto.randomUUID(), email, crypto.randomUUID(), hash, Date.now())
      .run();
  }
  const claim = await c.env.DB.prepare(
    "SELECT user_id,email,operation_id FROM bootstrap WHERE id=1 AND state='claimed'",
  ).first<{ user_id: string; email: string; operation_id: string }>();
  if (!claim || claim.email !== email)
    return c.json({ error: "Bootstrap already claimed" }, 409);
  const admin = adminAuth(c);
  // Persisted identity makes a lost provider response recoverable without promoting an existing account.
  let { data: existing } = await admin.auth.admin.getUserById(claim.user_id);
  if (!existing.user) {
    const created = await admin.auth.admin.createUser({
      id: claim.user_id,
      email,
      password,
      email_confirm: true,
    });
    if (created.error) {
      existing = (await admin.auth.admin.getUserById(claim.user_id)).data;
      if (!existing.user)
        return c.json(
          {
            error:
              "Unable to create reserved administrator; retry with the same email or inspect the claimed bootstrap",
          },
          409,
        );
    } else existing = created.data;
  }
  if (
    existing.user?.id !== claim.user_id ||
    existing.user.email?.toLowerCase() !== email
  )
    return c.json({ error: "Reserved identity mismatch" }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO members(user_id,email,role,status,created_at) SELECT user_id,email,'admin','active',? FROM bootstrap WHERE id=1 AND state='claimed' AND user_id=?",
    ).bind(Date.now(), claim.user_id),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) SELECT ?,operation_id,user_id,user_id,'bootstrap','Initial administrator',? FROM bootstrap WHERE id=1 AND state='claimed' AND user_id=?",
    ).bind(crypto.randomUUID(), Date.now(), claim.user_id),
    c.env.DB.prepare(
      "UPDATE bootstrap SET state='complete' WHERE id=1 AND state='claimed' AND user_id=?",
    ).bind(claim.user_id),
  ]);
  return c.json({ userId: claim.user_id }, 201);
});
