import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../../../server/types";
import { requireIdentity } from "../../../server/auth/auth";
import { catalog } from "./catalog";
import { checkout, portal } from "./checkout";
import { getEntitlements } from "./entitlements";
import { webhook } from "./webhook";
import { enqueue, processEvent } from "./reconcile";
import { reverseGrant } from "./admin";
export const billingRoutes = new Hono<AppEnv>();
billingRoutes.use("/billing/webhook", bodyLimit({ maxSize: 262144 }));
billingRoutes.use("/billing/checkout", bodyLimit({ maxSize: 16384 }));
billingRoutes.get("/billing/catalog", async (c) =>
  c.json(await catalog(c.env)),
);
billingRoutes.post("/billing/webhook", webhook);
billingRoutes.post("/billing/checkout", async (c) => {
  const identity = await requireIdentity(c);
  const body = z
    .object({
      planKey: z.enum(["monthly", "creditPack"]),
      operationId: z.uuid(),
    })
    .strict()
    .safeParse(await c.req.json());
  if (!body.success)
    throw new HTTPException(400, { message: "Invalid checkout request" });
  const result = await checkout(
    c.env,
    identity,
    body.data.planKey,
    body.data.operationId,
  );
  return c.json(result, "restart" in result ? 409 : 200);
});
billingRoutes.post("/billing/portal", async (c) =>
  c.json(await portal(c.env, await requireIdentity(c))),
);
billingRoutes.get("/billing", async (c) => {
  const identity = await requireIdentity(c);
  const orders = (
    await c.env.DB.prepare(
      "SELECT id,plan_key,state,created_at FROM billing_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(identity.userId)
      .all()
  ).results;
  const subscriptions = (
    await c.env.DB.prepare(
      "SELECT subscription_id,status,period_end,cancel_at_period_end,cancel_at FROM billing_subscriptions WHERE user_id=? ORDER BY period_end DESC LIMIT 20",
    )
      .bind(identity.userId)
      .all()
  ).results;
  return c.json({
    entitlements: await getEntitlements(c.env, identity.userId),
    orders,
    subscriptions,
  });
});
billingRoutes.get("/billing/orders/:id", async (c) => {
  const identity = await requireIdentity(c);
  const order = await c.env.DB.prepare(
    "SELECT id,state,plan_key FROM billing_orders WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("id"), identity.userId)
    .first<{ id: string; state: string; plan_key: string }>();
  if (!order) throw new HTTPException(404, { message: "Order not found" });
  const granted = await c.env.DB.prepare(
    "SELECT source_key FROM entitlement_sources WHERE user_id=? AND state='active' AND valid_from<=? AND ((source_key=?) OR (kind='subscription' AND valid_until>? AND subscription_id=(SELECT subscription_id FROM billing_orders WHERE id=?))) LIMIT 1",
  )
    .bind(
      identity.userId,
      Date.now(),
      `purchase:${order.id}`,
      Date.now(),
      order.id,
    )
    .first();
  return c.json({ ...order, confirmed: !!granted });
});
billingRoutes.get("/admin/billing", async (c) => {
  await requireIdentity(c, true);
  const query = z
    .object({
      userId: z.string().max(100).optional(),
      before: z.coerce.number().int().nonnegative().optional(),
    })
    .safeParse(c.req.query());
  if (!query.success)
    throw new HTTPException(400, { message: "Invalid filters" });
  const owner = query.data.userId || null,
    before = query.data.before || Date.now() + 1;
  const orders = (
    await c.env.DB.prepare(
      "SELECT id,user_id,plan_key,state,created_at FROM billing_orders WHERE (? IS NULL OR user_id=?) AND created_at<? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(owner, owner, before)
      .all()
  ).results;
  const subscriptions = (
    await c.env.DB.prepare(
      "SELECT * FROM billing_subscriptions WHERE (? IS NULL OR user_id=?) LIMIT 50",
    )
      .bind(owner, owner)
      .all()
  ).results;
  const events = (
    await c.env.DB.prepare(
      "SELECT event_id,type,object_id,state,attempts,error_code FROM billing_events WHERE state!='done' ORDER BY created_at LIMIT 50",
    ).all()
  ).results;
  const sources = (
    await c.env.DB.prepare(
      "SELECT source_key,user_id,remaining,state,review_reason FROM entitlement_sources WHERE (? IS NULL OR user_id=?) ORDER BY created_at DESC LIMIT 50",
    )
      .bind(owner, owner)
      .all()
  ).results;
  return c.json({ orders, subscriptions, events, sources });
});
billingRoutes.post("/admin/billing/retry", async (c) => {
  const actor = await requireIdentity(c, true);
  const parsed = z
    .object({
      operationId: z.uuid(),
      eventId: z.string().min(1).max(200),
      reason: z.string().trim().min(3).max(500),
    })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success)
    throw new HTTPException(400, {
      message: "Operation ID, event ID and reason required",
    });
  const b = parsed.data;
  const prior = await c.env.DB.prepare(
    "SELECT * FROM audit_log WHERE operation_id=?",
  )
    .bind(b.operationId)
    .first<{
      actor_id: string;
      target_id: string;
      reason: string;
      action: string;
    }>();
  if (
    prior &&
    (prior.actor_id !== actor.userId ||
      prior.target_id !== b.eventId ||
      prior.reason !== b.reason ||
      prior.action !== "billing.retry")
  )
    throw new HTTPException(409, { message: "Operation ID conflict" });
  if (
    !(await c.env.DB.prepare(
      "SELECT event_id FROM billing_events WHERE event_id=?",
    )
      .bind(b.eventId)
      .first())
  )
    throw new HTTPException(404, { message: "Event not found" });
  if (!prior)
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) VALUES(?,?,?,?,'billing.retry',?,?)",
      ).bind(
        crypto.randomUUID(),
        b.operationId,
        actor.userId,
        b.eventId,
        b.reason,
        Date.now(),
      ),
      c.env.DB.prepare(
        "UPDATE billing_events SET state='retry',next_attempt_at=0 WHERE event_id=? AND state IN('retry','review')",
      ).bind(b.eventId),
    ]);
  await processEvent(c.env, b.eventId);
  return c.json({ ok: true });
});
billingRoutes.post("/admin/billing/reconcile", async (c) => {
  const actor = await requireIdentity(c, true);
  const body = z
    .object({
      operationId: z.uuid(),
      objectId: z.string().regex(/^(cs_|sub_|in_)[a-zA-Z0-9_]+$/),
      reason: z.string().trim().min(3).max(500),
    })
    .strict()
    .safeParse(await c.req.json());
  if (!body.success)
    throw new HTTPException(400, { message: "Invalid reconciliation request" });
  const b = body.data,
    type = b.objectId.startsWith("cs_")
      ? "checkout.session.completed"
      : b.objectId.startsWith("sub_")
        ? "customer.subscription.updated"
        : "invoice.paid";
  const prior = await c.env.DB.prepare(
    "SELECT actor_id,target_id,reason,action FROM audit_log WHERE operation_id=?",
  )
    .bind(b.operationId)
    .first<{
      actor_id: string;
      target_id: string;
      reason: string;
      action: string;
    }>();
  if (
    prior &&
    (prior.actor_id !== actor.userId ||
      prior.target_id !== b.objectId ||
      prior.reason !== b.reason ||
      prior.action !== "billing.reconcile")
  )
    throw new HTTPException(409, { message: "Operation ID conflict" });
  if (!prior)
    await c.env.DB.prepare(
      "INSERT INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) VALUES(?,?,?,?,'billing.reconcile',?,?)",
    )
      .bind(
        crypto.randomUUID(),
        b.operationId,
        actor.userId,
        b.objectId,
        b.reason,
        Date.now(),
      )
      .run();
  await enqueue(c.env, `admin:${b.operationId}`, type, b.objectId);
  await processEvent(c.env, `admin:${b.operationId}`);
  return c.json({ ok: true });
});
billingRoutes.post("/admin/billing/adjust", async (c) => {
  const actor = await requireIdentity(c, true);
  const body = z
    .object({
      operationId: z.uuid(),
      sourceKey: z.string().min(1).max(200),
      quantity: z.number().int().min(-1000000).max(1000000),
      resolution: z.literal("resume").optional(),
      reason: z.string().trim().min(3).max(500),
    })
    .strict()
    .refine((v) => v.quantity !== 0 || v.resolution === "resume")
    .safeParse(await c.req.json());
  if (!body.success)
    throw new HTTPException(400, { message: "Invalid adjustment" });
  const b = body.data;
  const prior = await c.env.DB.prepare(
    "SELECT * FROM billing_adjustments WHERE operation_id=?",
  )
    .bind(b.operationId)
    .first<{
      source_key: string;
      quantity: number;
      actor_id: string;
      reason: string;
      resolution: string | null;
    }>();
  if (prior) {
    if (
      prior.source_key !== b.sourceKey ||
      prior.quantity !== b.quantity ||
      prior.actor_id !== actor.userId ||
      prior.reason !== b.reason ||
      prior.resolution !== (b.resolution || null)
    )
      throw new HTTPException(409, { message: "Operation ID conflict" });
    return c.json({ ok: true });
  }
  if (
    await c.env.DB.prepare("SELECT id FROM audit_log WHERE operation_id=?")
      .bind(b.operationId)
      .first()
  )
    throw new HTTPException(409, { message: "Operation ID conflict" });
  const source = await c.env.DB.prepare(
    "SELECT user_id FROM entitlement_sources WHERE source_key=?",
  )
    .bind(b.sourceKey)
    .first<{ user_id: string }>();
  if (!source) throw new HTTPException(404, { message: "Source not found" });
  const { claimCustomer, releaseCustomer } = await import("./checkout");
  const token = await claimCustomer(c.env, source.user_id);
  try {
    const guard =
      "source_key=? AND (state='active' OR (state='suspended' AND ?='resume')) AND refunded=0 AND remaining+?>=0 AND EXISTS(SELECT 1 FROM billing_locks WHERE user_id=? AND lease_token=? AND lease_until>?) AND NOT EXISTS(SELECT 1 FROM billing_adjustments WHERE operation_id=?)";
    const args = [
      b.sourceKey,
      b.resolution || null,
      b.quantity,
      source.user_id,
      token,
      Date.now(),
      b.operationId,
    ];
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO billing_adjustments(operation_id,source_key,quantity,actor_id,reason,created_at,resolution) SELECT ?,source_key,?,?,?,?,? FROM entitlement_sources WHERE ${guard}`,
      ).bind(
        b.operationId,
        b.quantity,
        actor.userId,
        b.reason,
        Date.now(),
        b.resolution || null,
        ...args,
      ),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO entitlement_ledger(operation_key,source_key,quantity,action,actor_id,reason,created_at) SELECT ?,source_key,quantity,'adjustment',actor_id,reason,created_at FROM billing_adjustments WHERE operation_id=?",
      ).bind(`adjust:${b.operationId}`, b.operationId),
      c.env.DB.prepare(
        "UPDATE entitlement_sources SET remaining=remaining+?,state=CASE WHEN ?='resume' THEN 'active' ELSE state END,review_reason=CASE WHEN ?='resume' THEN NULL ELSE review_reason END,resolved_fingerprint=CASE WHEN ?='resume' THEN review_fingerprint ELSE resolved_fingerprint END WHERE source_key=? AND changes()=1",
      ).bind(
        b.quantity,
        b.resolution || null,
        b.resolution || null,
        b.resolution || null,
        b.sourceKey,
      ),
      c.env.DB.prepare(
        "INSERT INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) SELECT ?,operation_id,actor_id,source_key,'billing.adjust',reason,created_at FROM billing_adjustments WHERE operation_id=?",
      ).bind(crypto.randomUUID(), b.operationId),
    ]);
    if (!results[0].meta.changes)
      throw new HTTPException(409, {
        message: "Source unavailable or insufficient credits",
      });
  } finally {
    await releaseCustomer(c.env, source.user_id, token);
  }
  return c.json({ ok: true });
});
billingRoutes.post("/admin/billing/reverse", async (c) => {
  const actor = await requireIdentity(c, true),
    body = z
      .object({
        operationId: z.uuid(),
        sourceKey: z.string().min(1).max(200),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .safeParse(await c.req.json());
  if (!body.success)
    throw new HTTPException(400, { message: "Invalid reversal" });
  await reverseGrant(
    c.env,
    body.data.sourceKey,
    body.data.operationId,
    actor,
    body.data.reason,
  );
  return c.json({ ok: true });
});
