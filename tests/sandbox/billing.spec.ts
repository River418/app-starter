// Opt-in REAL Stripe Sandbox API test. No provider fetch interception. Signature input is synthetic;
// provider-to-Worker Webhook delivery and hosted Checkout completion are separately reported gaps.
import { afterEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import Stripe from "stripe";
import config from "../../app.config";
import { user } from "../integration/fixtures";
import { app } from "../../src/server/app";
import { settings } from "../../src/features/billing/server/catalog";
import {
  hash,
  stripeClient,
  apiVersion,
  id,
} from "../../src/features/billing/server/stripe";
import { getEntitlements } from "../../src/features/billing/server/entitlements";
import { syncCatalog } from "../../scripts/billing-catalog.mjs";
afterEach(() => {
  config.billing = undefined;
});
it("real scoped catalog, Checkout/Portal creation, paid invoice grant, cancellation and confirmed refund", async () => {
  const stripe = stripeClient(env),
    account = await stripe.accounts.retrieveCurrent(),
    balance = await stripe.balance.retrieve();
  expect(balance.livemode).toBe(false);
  expect(account.id).toBe(
    (env as unknown as { STRIPE_SANDBOX_ACCOUNT_ID: string })
      .STRIPE_SANDBOX_ACCOUNT_ID,
  );
  config.billing = {
    enabled: true,
    currency: "usd",
    monthly: { amountMinor: 990, credits: 100 },
    creditPack: { amountMinor: 490, credits: 50 },
  };
  const member = await user(),
    rows = new Map<string, any>();
  let saved: any;
  const save = async (state: any, prices: any[]) => {
    saved = state;
    for (const p of prices) {
      rows.set(p.price_id, p);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO billing_prices VALUES(?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          p.price_id,
          p.namespace,
          p.plan_key,
          p.version,
          p.currency,
          p.amount_minor,
          p.credits,
          p.features,
          p.tax_behavior,
        )
        .run();
    }
  };
  save.origin = "http://localhost:5173";
  // The actual same catalog synchronizer is exercised against Stripe, not a stand-in.
  const first = await syncCatalog(stripe, {
    slug: config.slug,
    environment: "test",
    billing: settings(),
    save,
  });
  await syncCatalog(stripe, {
    slug: config.slug,
    environment: "test",
    billing: settings(),
    previous: first.state,
    save,
  });
  expect(rows.size).toBe(2);
  const state = {
    ...saved,
    key_hash: await hash(env.STRIPE_SECRET_KEY!),
    secret_hash: await hash(env.STRIPE_WEBHOOK_SECRET!),
    ready: 1,
  };
  await env.DB.prepare(
    "INSERT INTO billing_state(id,origin,namespace,account_id,livemode,config_hash,key_hash,portal_id,endpoint_id,secret_hash,ready) VALUES(1,?,?,?,?,?,?,?,?,?,1)",
  )
    .bind(
      state.origin,
      state.namespace,
      state.account_id,
      state.livemode,
      state.config_hash,
      state.key_hash,
      state.portal_id,
      "synthetic_test_signer",
      state.secret_hash,
    )
    .run();
  const call = (path: string, body?: unknown) =>
    app.request(
      "http://localhost:5173" + path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: "http://localhost:5173",
          Cookie: member.cookie(),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  const operationId = crypto.randomUUID(),
    checkout = await call("/api/billing/checkout", {
      planKey: "creditPack",
      operationId,
    });
  expect(checkout.status).toBe(200);
  const created = (await checkout.json()) as any,
    repeated = await call("/api/billing/checkout", {
      planKey: "creditPack",
      operationId,
    });
  expect(((await repeated.json()) as any).orderId).toBe(created.orderId);
  const portal = await call("/api/billing/portal", {});
  expect(portal.status).toBe(200);
  expect(
    ((await portal.json()) as any).url.startsWith(
      "https://billing.stripe.com/",
    ),
  ).toBe(true);
  expect((await getEntitlements(env, member.id)).credits).toBe(0);
  const mapping = (await env.DB.prepare(
    "SELECT customer_id FROM billing_customers WHERE user_id=?",
  )
    .bind(member.id)
    .first<{ customer_id: string }>())!;
  const method = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await stripe.paymentMethods.attach(method.id, {
    customer: mapping.customer_id,
  });
  const price = [...rows.values()].find((p) => p.plan_key === "monthly");
  const sub = await stripe.subscriptions.create({
    customer: mapping.customer_id,
    items: [{ price: price.price_id }],
    default_payment_method: method.id,
    metadata: {
      namespace: state.namespace,
      user_id: member.id,
      order_id: crypto.randomUUID(),
    },
    payment_behavior: "error_if_incomplete",
  });
  const invoiceId = id(sub.latest_invoice)!;
  const deliver = async (type: string, objectId: string) => {
    const payload = JSON.stringify({
      id: `evt_local_${crypto.randomUUID()}`,
      type,
      livemode: false,
      api_version: apiVersion,
      data: { object: { id: objectId } },
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET!,
      cryptoProvider: Stripe.createSubtleCryptoProvider(),
    });
    const response = await app.request(
      "http://localhost:5173/api/billing/webhook",
      {
        method: "POST",
        headers: { "Stripe-Signature": signature },
        body: payload,
      },
      env,
    );
    expect(response.status).toBe(200);
  };
  try {
    await deliver("invoice.paid", invoiceId);
    expect((await getEntitlements(env, member.id)).subscription).toBe(100);
    await deliver("invoice.paid", invoiceId);
    expect((await getEntitlements(env, member.id)).subscription).toBe(100);
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    await deliver("customer.subscription.updated", sub.id);
    expect((await getEntitlements(env, member.id)).subscription).toBe(100);
    const payments = await stripe.invoicePayments.list({
        invoice: invoiceId,
        status: "paid",
      }),
      pi = id(payments.data[0].payment.payment_intent)!;
    const refund = await stripe.refunds.create({ payment_intent: pi });
    expect(refund.status).toBe("succeeded");
    await deliver("refund.updated", refund.id);
    expect((await getEntitlements(env, member.id)).credits).toBe(0);
  } finally {
    await stripe.subscriptions.cancel(sub.id);
    const order = await env.DB.prepare(
      "SELECT session_id FROM billing_orders WHERE id=?",
    )
      .bind(created.orderId)
      .first<{ session_id: string }>();
    if (order?.session_id)
      await stripe.checkout.sessions.expire(order.session_id);
  }
});
