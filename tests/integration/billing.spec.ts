import { beforeEach, expect, it, vi, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import config from "../../app.config";
import { user, request } from "./fixtures";
import { getEntitlements } from "../../src/features/billing/server/entitlements";
import {
  seedBilling,
  seedOrder,
  provider,
  deliver,
  billingRequest,
  billingEnv,
} from "./billing-fixtures";
import {
  processEvent,
  enqueue,
  maintainBilling,
} from "../../src/features/billing/server/reconcile";
import { stripeClient } from "../../src/features/billing/server/stripe";

beforeEach(() => {
  config.billing = {
    enabled: true,
    currency: "usd",
    monthly: { amountMinor: 990, credits: 100 },
    creditPack: { amountMinor: 490, credits: 50 },
  };
});
afterEach(() => {
  config.billing = undefined;
  vi.restoreAllMocks();
});
it("keeps Checkout closed before signed setup readiness, and keeps secrets out of public config", async () => {
  const member = await user();
  const response = await request("/api/billing/checkout", {
    method: "POST",
    cookie: member.cookie(),
    body: { planKey: "creditPack", operationId: crypto.randomUUID() },
  });
  expect(response.status).toBe(503);
  expect(
    JSON.stringify(await (await request("/api/config")).json()),
  ).not.toMatch(/STRIPE|whsec_|sk_test/);
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
});
it("requires authentication and administrator membership for billing administration", async () => {
  expect((await request("/api/billing")).status).toBe(401);
  const member = await user();
  expect(
    (await request("/api/admin/billing", { cookie: member.cookie() })).status,
  ).toBe(403);
});
it("verifies the original body, timestamp and environment without an Origin header", async () => {
  const member = await user();
  await seedBilling(member.id);
  provider(member.id);
  await seedOrder(member.id);
  expect(
    (
      await deliver(
        "checkout.session.completed",
        "cs_local",
        undefined,
        false,
        true,
      )
    ).status,
  ).toBe(400);
  expect(
    (await deliver("checkout.session.completed", "cs_local", undefined, true))
      .status,
  ).toBe(400);
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  expect((await deliver("checkout.session.completed", "cs_local")).status).toBe(
    200,
  );
  expect((await getEntitlements(env, member.id)).purchased).toBe(50);
});
it("reuses persistent checkout operations and rejects parameter conflicts", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id),
    operationId = crypto.randomUUID();
  const body = { planKey: "creditPack", operationId };
  const first = await billingRequest(
    "/api/billing/checkout",
    member.cookie(),
    body,
  );
  expect(first.status).toBe(200);
  const again = await billingRequest(
    "/api/billing/checkout",
    member.cookie(),
    body,
  );
  expect(await again.json()).toEqual(await first.json());
  expect(p.creates).toBe(1);
  expect(p.createdBody?.get("customer")).toBe("cus_local");
  expect(p.createdBody?.get("line_items[0][price]")).toBe("price_creditPack");
  expect(
    (
      await billingRequest("/api/billing/checkout", member.cookie(), {
        ...body,
        planKey: "monthly",
      })
    ).status,
  ).toBe(409);
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
});
it("waits for payment, then deduplicates event IDs and business payments", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  await seedOrder(member.id);
  p.session.payment_status = "unpaid";
  await deliver("checkout.session.completed", "cs_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  const order = await billingRequest(
    "/api/billing/orders/order_local",
    member.cookie(),
  );
  expect(((await order.json()) as any).confirmed).toBe(false);
  p.session.payment_status = "paid";
  const eventId = crypto.randomUUID();
  await deliver(
    "checkout.session.async_payment_succeeded",
    "cs_local",
    eventId,
  );
  await deliver(
    "checkout.session.async_payment_succeeded",
    "cs_local",
    eventId,
  );
  await deliver("checkout.session.completed", "cs_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) AS n FROM entitlement_ledger WHERE action='grant'",
      ).first<any>()
    ).n,
  ).toBe(1);
});
it("retains a durable retry and recovers crashed/expired claims", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  await seedOrder(member.id);
  await enqueue(env, "evt_crash", "checkout.session.completed", "cs_local");
  await env.DB.prepare(
    "UPDATE billing_events SET state='processing',lease_token='dead',lease_until=0 WHERE event_id='evt_crash'",
  ).run();
  await processEvent(billingEnv, "evt_crash");
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
  await enqueue(env, "evt_retry", "checkout.session.completed", "cs_local");
  p.fail();
  await processEvent(billingEnv, "evt_retry");
  expect(
    (
      await env.DB.prepare(
        "SELECT state FROM billing_events WHERE event_id='evt_retry'",
      ).first<any>()
    ).state,
  ).toBe("retry");
  await env.DB.prepare(
    "UPDATE billing_events SET next_attempt_at=0 WHERE event_id='evt_retry'",
  ).run();
  await maintainBilling(billingEnv, 10);
  expect(
    (
      await env.DB.prepare(
        "SELECT state FROM billing_events WHERE event_id='evt_retry'",
      ).first<any>()
    ).state,
  ).toBe("done");
});
it("grants only paid invoice periods, preserves packs, and expires old periods without rollover", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  await seedOrder(member.id);
  await deliver("checkout.session.completed", "cs_local");
  p.intent.amount_received = 990;
  await deliver("invoice.paid", "in_local");
  await deliver("invoice.paid", "in_local");
  expect((await getEntitlements(env, member.id)).subscription).toBe(100);
  p.sub.cancel_at_period_end = true;
  await deliver("customer.subscription.updated", "sub_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(150);
  p.invoice.status = "open";
  await deliver("invoice.payment_failed", "in_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(150);
  p.invoice = { ...p.invoice }; // mutate the fixture's stored object below for old invoice delivery
  const old = { ...p.invoices.get("in_local"), id: "in_old", status: "paid" };
  p.invoices.set("in_old", old);
  p.invoiceLine.period = { start: 1, end: 2 };
  await deliver("invoice.paid", "in_old");
  expect((await getEntitlements(env, member.id)).credits).toBe(150);
  await env.DB.prepare(
    "UPDATE entitlement_sources SET valid_until=1 WHERE kind='subscription'",
  ).run();
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
});
it("reverses only the refunded source, and does not recreate a refund delivered before success", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  await seedOrder(member.id);
  await env.DB.prepare(
    "INSERT INTO entitlement_sources(source_key,user_id,kind,credits,remaining,features,created_at) VALUES('unrelated',?,'purchase',70,70,'[]',?)",
  )
    .bind(member.id, Date.now())
    .run();
  p.charge.refunded = true;
  p.charge.amount_refunded = 490;
  await deliver("checkout.session.completed", "cs_local");
  await deliver("charge.refunded", "ch_local");
  await deliver("checkout.session.completed", "cs_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(70);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM entitlement_ledger WHERE action='refund'",
      ).first<any>()
    ).n,
  ).toBe(1);
});
it("suspends disputes, restores a win and sends partial refunds to review", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  await seedOrder(member.id);
  await deliver("checkout.session.completed", "cs_local");
  p.charge.disputed = true;
  await deliver("charge.dispute.created", "dp_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  p.charge.disputed = false;
  p.dispute.status = "won";
  await deliver("charge.dispute.closed", "dp_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
  p.charge.amount_refunded = 100;
  await deliver("charge.refunded", "ch_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  expect((await getEntitlements(env, member.id)).sources[0].reviewReason).toBe(
    "partial_refund",
  );
});
it("audits idempotent adjustments and flags the consumed part of a full refund", async () => {
  const admin = await user("admin");
  await seedBilling(admin.id);
  const p = provider(admin.id);
  await seedOrder(admin.id);
  await deliver("checkout.session.completed", "cs_local");
  const body = {
    operationId: crypto.randomUUID(),
    sourceKey: "purchase:order_local",
    quantity: -10,
    reason: "Reconcile consumed usage",
  };
  expect(
    (await billingRequest("/api/admin/billing/adjust", admin.cookie(), body))
      .status,
  ).toBe(200);
  expect(
    (await billingRequest("/api/admin/billing/adjust", admin.cookie(), body))
      .status,
  ).toBe(200);
  expect((await getEntitlements(env, admin.id)).credits).toBe(40);
  expect(
    (
      await billingRequest("/api/admin/billing/adjust", admin.cookie(), {
        ...body,
        quantity: -11,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM audit_log WHERE operation_id=?",
      )
        .bind(body.operationId)
        .first<any>()
    ).n,
  ).toBe(1);
  p.charge.refunded = true;
  p.charge.amount_refunded = 490;
  await deliver("charge.refunded", "ch_local");
  expect((await getEntitlements(env, admin.id)).sources[0].reviewReason).toBe(
    "consumed_refund",
  );
});
it("fences stale workers and serializes different event IDs for the same payment", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  await seedOrder(member.id);
  p.beforeIntent(async () => {
    await env.DB.prepare(
      "UPDATE billing_locks SET lease_token='replacement',lease_until=0 WHERE user_id=?",
    )
      .bind(member.id)
      .run();
  });
  await deliver("checkout.session.completed", "cs_local", "evt_stale");
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  await env.DB.prepare(
    "UPDATE billing_events SET lease_until=0 WHERE event_id='evt_stale'",
  ).run();
  await processEvent(billingEnv, "evt_stale");
  await Promise.all([
    deliver("checkout.session.completed", "cs_local", "evt_parallel_a"),
    deliver(
      "checkout.session.async_payment_succeeded",
      "cs_local",
      "evt_parallel_b",
    ),
  ]);
  await env.DB.prepare(
    "UPDATE billing_events SET next_attempt_at=0 WHERE state='retry'",
  ).run();
  await maintainBilling(billingEnv, 10);
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM entitlement_ledger WHERE action='grant'",
      ).first<any>()
    ).n,
  ).toBe(1);
});
it("keeps webhook recovery working when new purchases are disabled and forbids hosted provider substitutes", async () => {
  const member = await user();
  await seedBilling(member.id);
  provider(member.id);
  await seedOrder(member.id);
  config.billing!.enabled = false;
  expect((await deliver("checkout.session.completed", "cs_local")).status).toBe(
    200,
  );
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
  expect(() =>
    stripeClient({
      ...billingEnv,
      APP_ENV: "dev",
      STRIPE_TEST_API_URL: "http://localhost:55431",
    }),
  ).toThrow(/forbidden/);
});
it("requires explicit audited review resolution and idempotent source reversal", async () => {
  const admin = await user("admin");
  await seedBilling(admin.id);
  const p = provider(admin.id);
  await seedOrder(admin.id);
  await deliver("checkout.session.completed", "cs_local");
  p.charge.amount_refunded = 100;
  await deliver("charge.refunded", "ch_local");
  const resume = {
    operationId: crypto.randomUUID(),
    sourceKey: "purchase:order_local",
    quantity: -10,
    resolution: "resume",
    reason: "Reviewed partial refund and retained remaining entitlement",
  };
  expect(
    (await billingRequest("/api/admin/billing/adjust", admin.cookie(), resume))
      .status,
  ).toBe(200);
  expect((await getEntitlements(env, admin.id)).credits).toBe(40);
  await deliver("charge.refunded", "ch_local");
  expect((await getEntitlements(env, admin.id)).credits).toBe(40);
  const reverse = {
    operationId: crypto.randomUUID(),
    sourceKey: "purchase:order_local",
    reason: "Resolved source review by revocation",
  };
  expect(
    (
      await billingRequest(
        "/api/admin/billing/reverse",
        admin.cookie(),
        reverse,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await billingRequest(
        "/api/admin/billing/reverse",
        admin.cookie(),
        reverse,
      )
    ).status,
  ).toBe(200);
  expect((await getEntitlements(env, admin.id)).credits).toBe(0);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM audit_log WHERE action LIKE 'billing.%'",
      ).first<any>()
    ).n,
  ).toBe(2);
});
it("reuses pending subscription Checkout and redirects an existing subscription to the owned Portal", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  const first = await billingRequest("/api/billing/checkout", member.cookie(), {
    planKey: "monthly",
    operationId: crypto.randomUUID(),
  });
  const second = await billingRequest(
    "/api/billing/checkout",
    member.cookie(),
    { planKey: "monthly", operationId: crypto.randomUUID() },
  );
  expect(await first.json()).toEqual(await second.json());
  expect(p.creates).toBe(1);
  p.activateSubscription();
  const active = await billingRequest(
    "/api/billing/checkout",
    member.cookie(),
    { planKey: "monthly", operationId: crypto.randomUUID() },
  );
  expect(((await active.json()) as any).kind).toBe("portal");
  expect(p.creates).toBe(1);
});
it("does not let an old canceled subscription event complete a new pending subscription order", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  const first = await billingRequest("/api/billing/checkout", member.cookie(), {
    planKey: "monthly",
    operationId: crypto.randomUUID(),
  });
  const order = (await first.json()) as any;
  p.sub.status = "canceled";
  await deliver("customer.subscription.deleted", "sub_local");
  const saved = await env.DB.prepare(
    "SELECT state,subscription_id FROM billing_orders WHERE id=?",
  )
    .bind(order.orderId)
    .first<any>();
  expect(saved.state).toBe("open");
  expect(saved.subscription_id).toBeNull();
  const again = await billingRequest("/api/billing/checkout", member.cookie(), {
    planKey: "monthly",
    operationId: crypto.randomUUID(),
  });
  expect(((await again.json()) as any).orderId).toBe(order.orderId);
  expect(p.creates).toBe(1);
});
it("applies new disputes even after a partial refund was explicitly resolved", async () => {
  const admin = await user("admin");
  await seedBilling(admin.id);
  const p = provider(admin.id);
  await seedOrder(admin.id);
  await deliver("checkout.session.completed", "cs_local");
  p.charge.amount_refunded = 100;
  await deliver("charge.refunded", "ch_local");
  await billingRequest("/api/admin/billing/adjust", admin.cookie(), {
    operationId: crypto.randomUUID(),
    sourceKey: "purchase:order_local",
    quantity: 0,
    resolution: "resume",
    reason: "Explicitly reviewed partial refund",
  });
  p.charge.disputed = true;
  await deliver("charge.dispute.created", "dp_local");
  expect((await getEntitlements(env, admin.id)).credits).toBe(0);
  p.dispute.status = "lost";
  await deliver("charge.dispute.closed", "dp_local");
  expect((await getEntitlements(env, admin.id)).sources[0].state).toBe(
    "reversed",
  );
});
it("reviews discounted or partially allocated invoices and recovers a missed refund callback", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  p.intent.amount_received = 495;
  p.invoice.amount_paid = 495;
  p.invoice.total = 495;
  p.invoice.amount_due = 495;
  p.invoice.total_discount_amounts = [{ amount: 495 }];
  await deliver("invoice.paid", "in_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  await seedOrder(member.id);
  p.intent.amount_received = 490;
  await deliver("checkout.session.completed", "cs_local");
  expect((await getEntitlements(env, member.id)).credits).toBe(50);
  p.charge.refunded = true;
  p.charge.amount_refunded = 490;
  await maintainBilling(billingEnv, 10);
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
});
it("keeps existing Portal available with purchases disabled and returns a structured expired-operation response", async () => {
  const member = await user();
  await seedBilling(member.id);
  const p = provider(member.id);
  const operationId = crypto.randomUUID();
  await billingRequest("/api/billing/checkout", member.cookie(), {
    planKey: "creditPack",
    operationId,
  });
  p.sessions.get("cs_created").status = "expired";
  const expired = await billingRequest(
    "/api/billing/checkout",
    member.cookie(),
    { planKey: "creditPack", operationId },
  );
  expect(expired.status).toBe(409);
  expect(((await expired.json()) as any).code).toBe("CHECKOUT_EXPIRED");
  config.billing!.enabled = false;
  expect(
    (await billingRequest("/api/billing/portal", member.cookie(), {})).status,
  ).toBe(200);
});
it("holds mismatched prices for review and keeps administrative retry idempotent and audited", async () => {
  const admin = await user("admin");
  await seedBilling(admin.id);
  const p = provider(admin.id);
  await seedOrder(admin.id);
  p.session.amount_subtotal = 1;
  await deliver("checkout.session.completed", "cs_local", "evt_review");
  expect((await getEntitlements(env, admin.id)).credits).toBe(0);
  expect(
    (
      await env.DB.prepare(
        "SELECT state FROM billing_events WHERE event_id='evt_review'",
      ).first<any>()
    ).state,
  ).toBe("review");
  p.session.amount_subtotal = 490;
  const body = {
    operationId: crypto.randomUUID(),
    eventId: "evt_review",
    reason: "Verified corrected provider price",
  };
  expect(
    (await billingRequest("/api/admin/billing/retry", admin.cookie(), body))
      .status,
  ).toBe(200);
  expect(
    (await billingRequest("/api/admin/billing/retry", admin.cookie(), body))
      .status,
  ).toBe(200);
  expect((await getEntitlements(env, admin.id)).credits).toBe(50);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM audit_log WHERE operation_id=?",
      )
        .bind(body.operationId)
        .first<any>()
    ).n,
  ).toBe(1);
  expect(
    (
      await billingRequest("/api/admin/billing/retry", admin.cookie(), {
        ...body,
        reason: "A different retry request",
      })
    ).status,
  ).toBe(409);
});
