import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { authClient, verifiedUser } from "./auth";
import { sha256 } from "./crypto";
import { config } from "../config";

export const invitations = new Hono<AppEnv>();
invitations.post("/resume", async (c) => {
  const input = z
    .object({ tokenHash: z.string().min(12).max(512) })
    .safeParse(await c.req.json());
  if (!input.success) return c.json({ error: "Invalid confirmation" }, 400);
  const action = await c.env.DB.prepare(
    "SELECT user_id FROM auth_actions WHERE token_hash=? AND state='verified' AND expires_at>?",
  )
    .bind(await sha256(input.data.tokenHash), Date.now())
    .first<{ user_id: string }>();
  if (!action) return c.json({ passwordRequired: false });
  const { user } = await verifiedUser(c);
  if (user.id !== action.user_id)
    return c.json({ error: "Link does not belong to this account" }, 403);
  return c.json({ passwordRequired: true });
});
invitations.post("/confirm", async (c) => {
  const input = z
    .object({
      tokenHash: z.string().min(12).max(512),
      type: z.enum(["invite", "recovery", "email"]),
    })
    .safeParse(await c.req.json());
  if (!input.success) return c.json({ error: "Invalid confirmation" }, 400);
  const { tokenHash, type } = input.data;
  const digest = await sha256(tokenHash);
  const action = await c.env.DB.prepare(
    "SELECT * FROM auth_actions WHERE token_hash=?",
  )
    .bind(digest)
    .first<{
      user_id: string;
      kind: string;
      state: string;
      expires_at: number;
    }>();
  if (
    action &&
    (action.kind !== type ||
      action.state !== "issued" ||
      action.expires_at <= Date.now())
  )
    return c.json({ error: "Link expired or already used" }, 410);
  if (!action && (config.authMode !== "public" || type === "invite"))
    return c.json({ error: "Link expired or invalid" }, 410);
  const auth = authClient(c);
  const { data, error } = await auth.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (error || !data.user || (action && action.user_id !== data.user.id))
    return c.json({ error: "Link expired or invalid" }, 410);
  if (action) {
    const result = await c.env.DB.prepare(
      "UPDATE auth_actions SET state='verified' WHERE token_hash=? AND state='issued' AND expires_at>?",
    )
      .bind(digest, Date.now())
      .run();
    if (!result.meta.changes)
      return c.json({ error: "Link expired or already used" }, 410);
  } else if (type === "recovery") {
    await c.env.DB.prepare(
      "INSERT INTO auth_actions(id,user_id,token_hash,kind,state,expires_at) VALUES(?,?,?,'recovery','verified',?)",
    )
      .bind(
        crypto.randomUUID(),
        data.user.id,
        digest,
        Date.now() + 15 * 60 * 1000,
      )
      .run();
  }
  return c.json({ passwordRequired: type !== "email" });
});
invitations.post("/complete", async (c) => {
  const input = z
    .object({
      tokenHash: z.string().min(12).max(512),
      password: z.string().min(12).max(128),
    })
    .safeParse(await c.req.json());
  if (!input.success) return c.json({ error: "Invalid password setup" }, 400);
  const digest = await sha256(input.data.tokenHash);
  const action = await c.env.DB.prepare(
    "SELECT * FROM auth_actions WHERE token_hash=? AND state='verified' AND expires_at>?",
  )
    .bind(digest, Date.now())
    .first<{
      id: string;
      user_id: string;
      kind: string;
      operation_id: string | null;
    }>();
  if (!action) return c.json({ error: "Link expired or invalid" }, 410);
  const { auth, user } = await verifiedUser(c);
  if (action.user_id !== user.id)
    return c.json({ error: "Link expired or invalid" }, 410);
  const member = await c.env.DB.prepare(
    "SELECT status FROM members WHERE user_id=?",
  )
    .bind(user.id)
    .first<{ status: string }>();
  const pendingAllowed =
    member?.status === "pending" &&
    (action.kind === "invite" || Boolean(action.operation_id));
  if (
    action.kind === "invite"
      ? !pendingAllowed
      : member?.status !== "active" && !pendingAllowed
  )
    return c.json({ error: "Account access denied" }, 403);
  const { error } = await auth.auth.updateUser({
    password: input.data.password,
  });
  if (error) return c.json({ error: "Password update failed" }, 400);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE members SET status='active' WHERE user_id=? AND status='pending' AND EXISTS(SELECT 1 FROM auth_actions WHERE id=? AND state='verified' AND expires_at>?)",
    ).bind(user.id, action.id, Date.now()),
    c.env.DB.prepare(
      "UPDATE auth_actions SET state='complete' WHERE id=? AND state='verified' AND expires_at>?",
    ).bind(action.id, Date.now()),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) SELECT ?,?,user_id,user_id,'password_setup','Confirmed account link',? FROM auth_actions WHERE id=? AND state='complete'",
    ).bind(crypto.randomUUID(), `complete-${action.id}`, Date.now(), action.id),
  ]);
  if (!results[1].meta.changes)
    return c.json(
      { error: "Link expired or revoked during password update" },
      410,
    );
  return c.json({ ok: true });
});
