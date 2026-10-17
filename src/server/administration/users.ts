import { Hono } from "hono";
import { z } from "zod";
import { requireIdentity, adminAuth } from "../auth/auth";
import { sha256 } from "../auth/crypto";
import type { AppEnv, AppContext } from "../types";

export const administration = new Hono<AppEnv>();
administration.use("*", async (c, next) => {
  await requireIdentity(c, true);
  await next();
});
administration.get("/users", async (c) => {
  const page = Math.max(1, Math.min(10000, Number(c.req.query("page")) || 1));
  const items = await c.env.DB.prepare(
    "SELECT user_id AS userId,email,role,status,created_at AS createdAt FROM members ORDER BY created_at DESC,user_id LIMIT 50 OFFSET ?",
  )
    .bind((page - 1) * 50)
    .all();
  return c.json({ items: items.results, page });
});
const operationSchema = z.object({
  operationId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});
async function issue(
  c: AppContext,
  kind: "invite" | "recovery",
  email: string,
  targetId: string | null,
  operation: z.infer<typeof operationSchema>,
) {
  const actor = c.get("identity");
  const claimed = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO auth_operations(operation_id,actor_id,target,kind,reason,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      operation.operationId,
      actor.userId,
      targetId || email,
      kind,
      operation.reason,
      Date.now(),
    )
    .run();
  if (!claimed.meta.changes)
    return c.json(
      {
        error:
          "Operation already issued or attempted; the one-time link is not retained. Use a new operation to reissue.",
      },
      409,
    );
  const { data, error } = await adminAuth(c).auth.admin.generateLink({
    type: kind,
    email,
    options: { redirectTo: `${c.env.APP_ORIGIN}/auth/confirm` },
  });
  if (
    error ||
    !data.user ||
    !data.properties?.hashed_token ||
    (targetId && data.user.id !== targetId)
  )
    return c.json(
      {
        error:
          "Unable to issue link; check Supabase configuration and account state",
      },
      409,
    );
  const id = crypto.randomUUID();
  const statements = [];
  if (kind === "invite")
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO members(user_id,email,role,status,created_at) VALUES(?,?,'member','pending',?) ON CONFLICT(user_id) DO NOTHING",
      ).bind(data.user.id, email, Date.now()),
    );
  statements.push(
    c.env.DB.prepare(
      "UPDATE auth_actions SET state='revoked' WHERE user_id=? AND kind=? AND state IN('issued','verified')",
    ).bind(data.user.id, kind),
    c.env.DB.prepare(
      "INSERT INTO auth_actions(id,operation_id,user_id,token_hash,kind,expires_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      id,
      operation.operationId,
      data.user.id,
      await sha256(data.properties.hashed_token),
      kind,
      Date.now() + 60 * 60 * 1000,
    ),
    c.env.DB.prepare(
      "INSERT INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      operation.operationId,
      actor.userId,
      data.user.id,
      `issue_${kind}`,
      operation.reason,
      Date.now(),
    ),
  );
  await c.env.DB.batch(statements);
  const link = new URL("/auth/confirm", c.env.APP_ORIGIN);
  link.searchParams.set("token_hash", data.properties.hashed_token);
  link.searchParams.set("type", kind);
  return c.json(
    {
      userId: data.user.id,
      link: link.href,
      actionId: id,
      expiresInSeconds: 3600,
    },
    201,
  );
}
administration.post("/invitations", async (c) => {
  const input = operationSchema
    .extend({ email: z.email().transform((v) => v.toLowerCase()) })
    .safeParse(await c.req.json());
  if (!input.success)
    return c.json({ error: "Email, reason and operationId are required" }, 400);
  const existing = await c.env.DB.prepare(
    "SELECT status FROM members WHERE email=?",
  )
    .bind(input.data.email)
    .first<{ status: string }>();
  if (existing?.status === "active" || existing?.status === "disabled")
    return c.json({ error: "Account already belongs to application" }, 409);
  return issue(c, "invite", input.data.email, null, input.data);
});
administration.post("/users/:id/recovery", async (c) => {
  const input = operationSchema.safeParse(await c.req.json());
  if (!input.success)
    return c.json({ error: "Reason and operationId are required" }, 400);
  const member = await c.env.DB.prepare(
    "SELECT email FROM members WHERE user_id=? AND status IN('active','pending')",
  )
    .bind(c.req.param("id"))
    .first<{ email: string }>();
  if (!member) return c.json({ error: "User not found" }, 404);
  return issue(c, "recovery", member.email, c.req.param("id"), input.data);
});
administration.post("/actions/:id/revoke", async (c) => {
  const input = operationSchema.safeParse(await c.req.json());
  if (!input.success)
    return c.json({ error: "Reason and operationId are required" }, 400);
  const actor = c.get("identity");
  const action = await c.env.DB.prepare(
    "SELECT user_id,kind,state FROM auth_actions WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ user_id: string; kind: string; state: string }>();
  if (!action) return c.json({ error: "Action not found" }, 404);
  if (action.kind === "recovery")
    return c.json(
      {
        error:
          "Recovery links cannot be revoked by this app. Issue a replacement or manage sessions in Supabase.",
      },
      409,
    );
  const claimed = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO auth_operations(operation_id,actor_id,target,kind,reason,created_at) VALUES(?,?,?,'revoke',?,?)",
  )
    .bind(
      input.data.operationId,
      actor.userId,
      c.req.param("id"),
      input.data.reason,
      Date.now(),
    )
    .run();
  if (!claimed.meta.changes)
    return c.json({ error: "Operation already attempted" }, 409);
  const revoked = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE auth_actions SET state='revoked' WHERE id=? AND kind='invite' AND state IN('issued','verified') AND EXISTS(SELECT 1 FROM members WHERE user_id=auth_actions.user_id AND status='pending')",
    ).bind(c.req.param("id")),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) SELECT ?,?,?,?,'revoke_link',?,? WHERE changes()=1",
    ).bind(
      crypto.randomUUID(),
      input.data.operationId,
      actor.userId,
      action.user_id,
      input.data.reason,
      Date.now(),
    ),
  ]);
  if (!revoked[0].meta.changes)
    return c.json({ error: "Invitation already completed or revoked" }, 409);
  return c.json({ ok: true });
});
