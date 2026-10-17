import Stripe from "stripe";
import { vi } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "../../src/server/app";
import { settings } from "../../src/features/billing/server/catalog";
import { hash } from "../../src/features/billing/server/stripe";
export const billingEnv = {
  ...env,
  STRIPE_SECRET_KEY: "sk_test_local_fixture_only",
  STRIPE_WEBHOOK_SECRET: "whsec_local_fixture_only",
};
export let namespace = "";
export async function seedBilling(userId: string) {
  namespace = (await hash("app-starter:test:acct_local:false")).slice(0, 32);
  await env.DB.prepare(
    "INSERT INTO billing_state(id,namespace,account_id,livemode,config_hash,key_hash,origin,portal_id,endpoint_id,secret_hash,ready) VALUES(1,?,'acct_local',0,?,?,'http://localhost:5173','bpc_local','we_local',?,1)",
  )
    .bind(
      namespace,
      await hash(settings()),
      await hash(billingEnv.STRIPE_SECRET_KEY),
      await hash(billingEnv.STRIPE_WEBHOOK_SECRET),
    )
    .run();
  for (const p of settings().plans)
    await env.DB.prepare("INSERT INTO billing_prices VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(
        `price_${p.key}`,
        namespace,
        p.key,
        await hash({
          ...p,
          currency: settings().currency,
          taxBehavior: settings().taxBehavior,
        }),
        "usd",
        p.amountMinor,
        p.credits,
        JSON.stringify(p.features),
        "exclusive",
      )
      .run();
  await env.DB.prepare(
    "INSERT INTO billing_customers(user_id,customer_id) VALUES(?,?)",
  )
    .bind(userId, "cus_local")
    .run();
}
export async function billingRequest(
  path: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(
    `http://localhost:5173${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: billingEnv.APP_ORIGIN,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    billingEnv,
  );
}
export async function deliver(
  type: string,
  objectId: string,
  eventId = crypto.randomUUID(),
  livemode = false,
  alter = false,
) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type,
    livemode,
    api_version: "2026-09-30.endive",
    data: { object: { id: objectId } },
  });
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: billingEnv.STRIPE_WEBHOOK_SECRET,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
  return app.request(
    "http://localhost:5173/api/billing/webhook",
    {
      method: "POST",
      headers: { "Stripe-Signature": header },
      body: alter ? `${payload} ` : payload,
    },
    billingEnv,
  );
}
export function provider(userId: string) {
  const original = globalThis.fetch;
  const metadata = { namespace, user_id: userId, order_id: "order_local" };
  const session: any = {
    id: "cs_local",
    object: "checkout.session",
    livemode: false,
    client_reference_id: "order_local",
    customer: "cus_local",
    metadata,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "usd",
    amount_subtotal: 490,
    amount_total: 490,
    payment_intent: "pi_local",
    subscription: null,
    url: "https://checkout.stripe.com/local-fixture",
  };
  const charge: any = {
    id: "ch_local",
    object: "charge",
    livemode: false,
    customer: "cus_local",
    payment_intent: "pi_local",
    amount: 490,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
  };
  const intent: any = {
    id: "pi_local",
    object: "payment_intent",
    livemode: false,
    status: "succeeded",
    customer: "cus_local",
    currency: "usd",
    amount_received: 490,
    metadata,
    latest_charge: charge,
  };
  const start = Math.floor(Date.now() / 1000) - 10;
  const sub: any = {
    id: "sub_local",
    object: "subscription",
    livemode: false,
    customer: "cus_local",
    metadata,
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_local",
          price: { id: "price_monthly" },
          quantity: 1,
          current_period_start: start,
          current_period_end: start + 2600000,
        },
      ],
      has_more: false,
    },
  };
  const invoice: any = {
    id: "in_local",
    object: "invoice",
    livemode: false,
    customer: "cus_local",
    status: "paid",
    currency: "usd",
    subtotal: 990,
    amount_paid: 990,
    total: 990,
    amount_due: 990,
    discounts: [],
    total_discount_amounts: [],
    amount_remaining: 0,
    collection_method: "charge_automatically",
    billing_reason: "subscription_cycle",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_local" },
    },
  };
  const invoiceLine: any = {
    id: "il_local",
    object: "line_item",
    amount: 990,
    quantity: 1,
    pricing: { price_details: { price: "price_monthly" } },
    parent: { subscription_item_details: { proration: false } },
    period: { start, end: start + 2600000 },
  };
  const dispute: any = {
    id: "dp_local",
    object: "dispute",
    livemode: false,
    charge: "ch_local",
    status: "needs_response",
  };
  let creates = 0,
    failNext = 0,
    createdBody: URLSearchParams | undefined,
    hook: (() => Promise<void>) | undefined,
    activeSubscription = false;
  const sessions = new Map<string, any>([["cs_local", session]]),
    invoices = new Map<string, any>([["in_local", invoice]]);
  const list = (data: any[]) => ({
    object: "list",
    data,
    has_more: false,
    url: "/v1/local",
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname !== "api.stripe.com") return original(input, init);
    if (failNext) {
      failNext--;
      return Response.json(
        { error: { message: "Temporary provider error", type: "api_error" } },
        { status: 503 },
      );
    }
    const path = url.pathname;
    let data: any;
    if (path === "/v1/subscriptions")
      data = list(activeSubscription ? [sub] : []);
    else if (path === "/v1/subscriptions/sub_local") data = sub;
    else if (path === "/v1/checkout/sessions" && init?.method === "POST") {
      creates++;
      createdBody = new URLSearchParams(init.body as string);
      data = {
        ...session,
        id: "cs_created",
        status: "open",
        payment_status: "unpaid",
        client_reference_id: createdBody.get("client_reference_id"),
        metadata: {
          namespace,
          user_id: userId,
          order_id: createdBody.get("client_reference_id"),
        },
        mode: createdBody.get("mode"),
      };
      sessions.set(data.id, data);
    } else if (path === "/v1/checkout/sessions")
      data = list([...sessions.values()]);
    else if (path.match(/^\/v1\/checkout\/sessions\/[^/]+\/line_items$/))
      data = list([
        {
          price: {
            id:
              session.mode === "subscription"
                ? "price_monthly"
                : "price_creditPack",
          },
          quantity: 1,
        },
      ]);
    else if (path.startsWith("/v1/checkout/sessions/"))
      data = sessions.get(path.split("/").at(-1)!);
    else if (path === "/v1/payment_intents/pi_local") {
      data = intent;
      if (hook) {
        const h = hook;
        hook = undefined;
        await h();
      }
    } else if (path === "/v1/charges/ch_local") data = charge;
    else if (path === "/v1/disputes/dp_local") data = dispute;
    else if (path === "/v1/disputes") data = list([dispute]);
    else if (path === "/v1/refunds")
      data = list([
        { id: "re_local", status: "succeeded", amount: charge.amount_refunded },
      ]);
    else if (path === "/v1/invoice_payments")
      data = list([
        {
          invoice: "in_local",
          currency: "usd",
          amount_paid: invoice.amount_paid,
          amount_requested: invoice.amount_due,
          is_default: true,
          payment: { type: "payment_intent", payment_intent: "pi_local" },
        },
      ]);
    else if (path === "/v1/invoices") data = list([...invoices.values()]);
    else if (path.match(/^\/v1\/invoices\/[^/]+\/lines$/))
      data = list([invoiceLine]);
    else if (path.startsWith("/v1/invoices/"))
      data = invoices.get(path.split("/").at(-1)!);
    else if (path === "/v1/billing_portal/sessions")
      data = { url: "https://billing.stripe.com/local-fixture" };
    else throw new Error(`Unimplemented Stripe fixture: ${path}`);
    return data
      ? Response.json(data)
      : Response.json(
          { error: { message: "missing", type: "invalid_request_error" } },
          { status: 404 },
        );
  });
  return {
    session,
    charge,
    intent,
    sub,
    invoice,
    invoiceLine,
    dispute,
    sessions,
    invoices,
    get creates() {
      return creates;
    },
    get createdBody() {
      return createdBody;
    },
    fail() {
      failNext = 2;
    },
    beforeIntent(h: () => Promise<void>) {
      hook = h;
    },
    activateSubscription() {
      activeSubscription = true;
    },
  };
}
export async function seedOrder(
  userId: string,
  id = "order_local",
  sessionId = "cs_local",
) {
  await env.DB.prepare(
    "INSERT INTO billing_orders(id,user_id,operation_id,plan_key,price_id,session_id,payment_intent,state,created_at) VALUES(?,?,?,'creditPack','price_creditPack',?,'pi_local','open',?)",
  )
    .bind(id, userId, crypto.randomUUID(), sessionId, Date.now())
    .run();
}
