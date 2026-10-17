import { HTTPException } from "hono/http-exception";
import type { Bindings, Identity } from "../../../server/types";
import { readyState, currentPrice, operationalState } from "./catalog";
import { stripeClient, hash } from "./stripe";
import { config } from "../../../server/config";
import type { PlanKey } from "../shared/contracts";
export interface Customer {
  user_id: string;
  customer_id: string;
  lease_token: string | null;
  lease_until: number;
}
export interface Order {
  id: string;
  user_id: string;
  operation_id: string;
  plan_key: PlanKey;
  price_id: string;
  session_id: string | null;
  payment_intent: string | null;
  subscription_id: string | null;
  url: string | null;
  state: string;
  created_at: number;
}
export async function customer(env: Bindings, identity: Identity) {
  const state = await readyState(env);
  let mapping = await env.DB.prepare(
    "SELECT * FROM billing_customers WHERE user_id=?",
  )
    .bind(identity.userId)
    .first<Customer>();
  if (!mapping) {
    const stripe = stripeClient(env);
    const value = await stripe.customers.create(
      {
        email: identity.email,
        metadata: { namespace: state.namespace, user_id: identity.userId },
      },
      { idempotencyKey: `customer:${state.namespace}:${identity.userId}` },
    );
    await env.DB.prepare(
      "INSERT OR IGNORE INTO billing_customers(user_id,customer_id) VALUES(?,?)",
    )
      .bind(identity.userId, value.id)
      .run();
    mapping = await env.DB.prepare(
      "SELECT * FROM billing_customers WHERE user_id=?",
    )
      .bind(identity.userId)
      .first<Customer>();
  }
  return mapping!;
}
export async function claimCustomer(env: Bindings, userId: string) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO billing_locks(user_id) VALUES(?)")
    .bind(userId)
    .run();
  const result = await env.DB.prepare(
    "UPDATE billing_locks SET lease_token=?,lease_until=? WHERE user_id=? AND lease_until<=?",
  )
    .bind(token, Date.now() + 60000, userId, Date.now())
    .run();
  if (!result.meta.changes)
    throw new HTTPException(409, {
      message: "Billing operation in progress; retry shortly",
    });
  return token;
}
export async function releaseCustomer(
  env: Bindings,
  userId: string,
  token: string,
) {
  await env.DB.prepare(
    "UPDATE billing_locks SET lease_token=NULL,lease_until=0 WHERE user_id=? AND lease_token=?",
  )
    .bind(userId, token)
    .run();
}
export async function portal(env: Bindings, identity: Identity) {
  const state = await operationalState(env),
    c = await env.DB.prepare("SELECT * FROM billing_customers WHERE user_id=?")
      .bind(identity.userId)
      .first<Customer>();
  if (!c)
    throw new HTTPException(404, { message: "No billing customer exists yet" });
  const session = await stripeClient(env).billingPortal.sessions.create({
    customer: c.customer_id,
    configuration: state.portal_id,
    return_url: `${env.APP_ORIGIN}/app/billing`,
  });
  return { url: session.url };
}
export async function checkout(
  env: Bindings,
  identity: Identity,
  planKey: PlanKey,
  operationId: string,
) {
  const state = await readyState(env),
    c = await customer(env, identity),
    stripe = stripeClient(env);
  const token = await claimCustomer(env, identity.userId);
  try {
    let order = await env.DB.prepare(
      "SELECT * FROM billing_orders WHERE user_id=? AND operation_id=?",
    )
      .bind(identity.userId, operationId)
      .first<Order>();
    if (order && order.plan_key !== planKey)
      throw new HTTPException(409, {
        message: "Operation ID was used with different parameters",
      });
    if (planKey === "monthly") {
      // Refresh even when subscription webhooks have not arrived yet. Never create a second subscription.
      for await (const sub of stripe.subscriptions.list({
        customer: c.customer_id,
        status: "all",
        limit: 100,
      })) {
        if (
          sub.metadata.namespace === state.namespace &&
          !["canceled", "incomplete_expired"].includes(sub.status)
        )
          return { ...(await portal(env, identity)), kind: "portal" };
      }
      order ||= await env.DB.prepare(
        "SELECT * FROM billing_orders WHERE user_id=? AND plan_key='monthly' AND state IN('creating','open','processing')",
      )
        .bind(identity.userId)
        .first<Order>();
    }
    if (order?.session_id) {
      const session = await stripe.checkout.sessions.retrieve(order.session_id);
      if (session.status === "open" && session.url)
        return { url: session.url, orderId: order.id, kind: "checkout" };
      if (session.status === "complete")
        return {
          url: `${env.APP_ORIGIN}/app/billing/return?order=${order.id}`,
          orderId: order.id,
          kind: "return",
        };
      await env.DB.prepare(
        "UPDATE billing_orders SET state='expired',url=NULL WHERE id=?",
      )
        .bind(order.id)
        .run();
      if (order.operation_id === operationId)
        return {
          error: "Checkout expired; start a new operation",
          code: "CHECKOUT_EXPIRED",
          restart: true,
        } as const;
      order = null;
    }
    if (!order) {
      const price = await currentPrice(env, planKey, state);
      order = {
        id: crypto.randomUUID(),
        user_id: identity.userId,
        operation_id: operationId,
        plan_key: planKey,
        price_id: price.price_id,
        session_id: null,
        payment_intent: null,
        subscription_id: null,
        url: null,
        state: "creating",
        created_at: Date.now(),
      };
      await env.DB.prepare(
        "INSERT INTO billing_orders(id,user_id,operation_id,plan_key,price_id,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          order.id,
          order.user_id,
          operationId,
          planKey,
          price.price_id,
          order.created_at,
        )
        .run();
    }
    // Beyond Stripe's idempotency retention, recover from provider history; do not risk a second charge.
    let recovered;
    if (Date.now() - order.created_at > 23 * 3600000) {
      for await (const s of stripe.checkout.sessions.list({
        customer: c.customer_id,
        limit: 100,
      }))
        if (
          s.client_reference_id === order.id &&
          s.metadata?.namespace === state.namespace
        ) {
          recovered = s;
          break;
        }
      if (!recovered)
        throw new HTTPException(409, {
          message: "Checkout creation needs administrator reconciliation",
        });
    }
    const metadata = {
      namespace: state.namespace,
      order_id: order.id,
      user_id: identity.userId,
      app: config.slug,
      environment: env.APP_ENV,
    };
    const session =
      recovered ||
      (await stripe.checkout.sessions.create(
        {
          customer: c.customer_id,
          client_reference_id: order.id,
          mode: planKey === "monthly" ? "subscription" : "payment",
          line_items: [{ price: order.price_id, quantity: 1 }],
          metadata,
          ...(planKey === "monthly"
            ? { subscription_data: { metadata } }
            : { payment_intent_data: { metadata } }),
          adaptive_pricing: { enabled: false },
          automatic_tax: { enabled: !!config.billing?.automaticTax },
          success_url: `${env.APP_ORIGIN}/app/billing/return?order=${order.id}`,
          cancel_url: `${env.APP_ORIGIN}/app/billing`,
        },
        { idempotencyKey: `checkout:${state.namespace}:${order.id}` },
      ));
    const saved = await env.DB.prepare(
      "UPDATE billing_orders SET session_id=?,url=?,state='open' WHERE id=? AND EXISTS(SELECT 1 FROM billing_locks WHERE user_id=? AND lease_token=? AND lease_until>?)",
    )
      .bind(
        session.id,
        session.url,
        order.id,
        identity.userId,
        token,
        Date.now(),
      )
      .run();
    if (!saved.meta.changes)
      throw new HTTPException(409, {
        message: "Billing lease expired; retry operation",
      });
    return {
      url:
        session.url || `${env.APP_ORIGIN}/app/billing/return?order=${order.id}`,
      orderId: order.id,
      kind: "checkout",
    };
  } finally {
    await releaseCustomer(env, identity.userId, token);
  }
}
