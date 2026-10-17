import Stripe from "stripe";
import type { Bindings } from "../../../server/types";
import { operationalState, type Price } from "./catalog";
import { stripeClient, id } from "./stripe";
import {
  claimCustomer,
  releaseCustomer,
  type Customer,
  type Order,
} from "./checkout";
import type { Source } from "./entitlements";
interface Inbox {
  event_id: string;
  type: string;
  object_id: string;
  state: string;
  lease_token: string;
  attempts: number;
}
class Review extends Error {
  constructor(public code: string) {
    super(code);
  }
}
// Every business statement is fenced against both leases. A conditional no-op never permits a later unfenced grant.
function fence(event: Inbox, c: Customer, token: string) {
  return {
    sql: "EXISTS(SELECT 1 FROM billing_events WHERE event_id=? AND lease_token=? AND state='processing' AND lease_until>?) AND EXISTS(SELECT 1 FROM billing_locks WHERE user_id=? AND lease_token=? AND lease_until>?)",
    args: [
      event.event_id,
      event.lease_token,
      Date.now(),
      c.user_id,
      token,
      Date.now(),
    ],
  };
}
export async function processEvent(env: Bindings, eventId: string) {
  const eventToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    "UPDATE billing_events SET state='processing',lease_token=?,lease_until=?,attempts=attempts+1 WHERE event_id=? AND ((state IN('received','retry') AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?))",
  )
    .bind(eventToken, Date.now() + 60000, eventId, Date.now(), Date.now())
    .run();
  if (!claimed.meta.changes) return;
  const event = (await env.DB.prepare(
    "SELECT * FROM billing_events WHERE event_id=?",
  )
    .bind(eventId)
    .first<Inbox>())!;
  let customer: Customer | null = null,
    token = "";
  try {
    const stripe = stripeClient(env),
      state = await operationalState(env);
    let object:
      | Stripe.Checkout.Session
      | Stripe.Subscription
      | Stripe.Invoice
      | Stripe.Charge
      | Stripe.Refund
      | Stripe.Dispute;
    if (event.type === "app_starter.payment_risk") {
      const intent = await stripe.paymentIntents.retrieve(event.object_id);
      const chargeId = id(intent.latest_charge);
      if (!chargeId) throw new Review("missing_charge");
      object = await stripe.charges.retrieve(chargeId);
    } else if (event.type.startsWith("checkout.session."))
      object = await stripe.checkout.sessions.retrieve(event.object_id);
    else if (event.type.startsWith("customer.subscription."))
      object = await stripe.subscriptions.retrieve(event.object_id);
    else if (event.type.startsWith("invoice."))
      object = await stripe.invoices.retrieve(event.object_id);
    else if (event.type.startsWith("charge.dispute."))
      object = await stripe.disputes.retrieve(event.object_id);
    else if (event.type.startsWith("refund."))
      object = await stripe.refunds.retrieve(event.object_id);
    else object = await stripe.charges.retrieve(event.object_id);
    let customerId =
      "customer" in object
        ? id(object.customer as string | { id: string })
        : undefined;
    let charge: Stripe.Charge | undefined;
    if (object.object === "dispute" || object.object === "refund") {
      const chargeId = id(object.charge);
      if (!chargeId) throw new Review("missing_charge");
      charge = await stripe.charges.retrieve(chargeId);
      customerId = id(charge.customer);
    }
    if (!customerId) throw new Review("missing_customer");
    customer = await env.DB.prepare(
      "SELECT * FROM billing_customers WHERE customer_id=?",
    )
      .bind(customerId)
      .first<Customer>();
    if (!customer) throw new Review("unknown_customer");
    token = await claimCustomer(env, customer.user_id);
    // Refetch AFTER the per-customer claim so distinct event workers cannot apply stale provider snapshots.
    if (object.object === "checkout.session")
      object = await stripe.checkout.sessions.retrieve(object.id);
    else if (object.object === "subscription")
      object = await stripe.subscriptions.retrieve(object.id);
    else if (object.object === "invoice")
      object = await stripe.invoices.retrieve(object.id);
    else if (object.object === "charge")
      object = await stripe.charges.retrieve(object.id);
    else if (object.object === "refund") {
      object = await stripe.refunds.retrieve(object.id);
      charge = await stripe.charges.retrieve(id(object.charge)!);
    } else {
      object = await stripe.disputes.retrieve(object.id);
      charge = await stripe.charges.retrieve(id(object.charge)!);
    }
    if ("livemode" in object && object.livemode !== Boolean(state.livemode))
      throw new Review("wrong_mode");
    const guard = fence(event, customer, token),
      statements: D1PreparedStatement[] = [];
    const sql = (text: string, args: unknown[] = []) =>
      env.DB.prepare(text.replaceAll("$GUARD", guard.sql)).bind(
        ...args,
        ...guard.args,
      );
    const reviewSource = (
      sourceKey: string,
      reason: string,
      suspend = false,
      fingerprint = reason,
    ) =>
      statements.push(
        sql(
          `UPDATE entitlement_sources SET review_reason=?,review_fingerprint=?,state=CASE WHEN ? THEN 'suspended' ELSE state END WHERE source_key=? AND (resolved_fingerprint IS NULL OR resolved_fingerprint!=?) AND $GUARD`,
          [reason, fingerprint, suspend ? 1 : 0, sourceKey, fingerprint],
        ),
      );
    const price = async (priceId: string) => {
      const p = await env.DB.prepare(
        "SELECT * FROM billing_prices WHERE price_id=? AND namespace=?",
      )
        .bind(priceId, state.namespace)
        .first<Price>();
      if (!p) throw new Review("unknown_price");
      return p;
    };
    const grant = (
      key: string,
      p: Price,
      kind: string,
      pi: string | null,
      start = 0,
      end: number | null = null,
      subscriptionId: string | null = null,
    ) => {
      statements.push(
        sql(
          "INSERT OR IGNORE INTO entitlement_sources(source_key,user_id,kind,price_id,payment_intent,credits,remaining,features,valid_from,valid_until,subscription_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE $GUARD",
          [
            key,
            customer!.user_id,
            kind,
            p.price_id,
            pi,
            p.credits,
            p.credits,
            p.features,
            start,
            end,
            subscriptionId,
            Date.now(),
          ],
        ),
      );
      statements.push(
        sql(
          "INSERT OR IGNORE INTO entitlement_ledger(operation_key,source_key,quantity,action,created_at) SELECT ?,source_key,credits,'grant',? FROM entitlement_sources WHERE source_key=? AND $GUARD",
          [`grant:${key}`, Date.now(), key],
        ),
      );
    };
    const subscription = async (sub: Stripe.Subscription) => {
      if (
        id(sub.customer) !== customerId ||
        sub.metadata.namespace !== state.namespace ||
        sub.metadata.user_id !== customer!.user_id ||
        sub.items.data.length !== 1 ||
        sub.items.has_more
      )
        throw new Review("subscription_mismatch");
      const item = sub.items.data[0],
        p = await price(item.price.id);
      if (p.plan_key !== "monthly" || item.quantity !== 1)
        throw new Review("subscription_price");
      statements.push(
        sql(
          "INSERT INTO billing_subscriptions(subscription_id,user_id,customer_id,price_id,status,period_start,period_end,cancel_at_period_end,reconcile_at,cancel_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE $GUARD ON CONFLICT(subscription_id) DO UPDATE SET status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,cancel_at_period_end=excluded.cancel_at_period_end,reconcile_at=excluded.reconcile_at,cancel_at=excluded.cancel_at",
          [
            sub.id,
            customer!.user_id,
            customerId,
            p.price_id,
            sub.status,
            item.current_period_start * 1000,
            item.current_period_end * 1000,
            sub.cancel_at_period_end ? 1 : 0,
            Date.now() + 3600000,
            sub.cancel_at != null
              ? sub.cancel_at * 1000
              : sub.cancel_at_period_end
                ? item.current_period_end * 1000
                : null,
          ],
        ),
      );
      statements.push(
        sql(
          "UPDATE billing_orders SET state=?,subscription_id=? WHERE id=? AND user_id=? AND plan_key='monthly' AND (subscription_id IS NULL OR subscription_id=?) AND $GUARD",
          [
            sub.status === "canceled"
              ? "canceled"
              : sub.status === "incomplete_expired"
                ? "expired"
                : sub.status === "incomplete"
                  ? "processing"
                  : "completed",
            sub.id,
            sub.metadata.order_id || "",
            customer!.user_id,
            sub.id,
          ],
        ),
      );
      return sub;
    };
    if (object.object === "checkout.session") {
      const session = object,
        order = await env.DB.prepare(
          "SELECT * FROM billing_orders WHERE id=? AND user_id=?",
        )
          .bind(session.client_reference_id, customer.user_id)
          .first<Order>();
      if (
        !order ||
        session.metadata?.namespace !== state.namespace ||
        session.metadata?.order_id !== order.id ||
        session.metadata?.user_id !== customer.user_id ||
        id(session.customer) !== customerId ||
        session.mode !==
          (order.plan_key === "monthly" ? "subscription" : "payment")
      )
        throw new Review("checkout_mismatch");
      const lines = await stripe.checkout.sessions.listLineItems(session.id, {
          limit: 100,
        }),
        p = await price(order.price_id);
      if (
        lines.has_more ||
        lines.data.length !== 1 ||
        id(lines.data[0].price) !== p.price_id ||
        lines.data[0].quantity !== 1 ||
        session.currency !== p.currency ||
        session.amount_subtotal !== p.amount_minor
      )
        throw new Review("checkout_price");
      let status =
        session.status === "expired"
          ? "expired"
          : session.payment_status === "paid"
            ? "paid"
            : event.type === "checkout.session.async_payment_failed"
              ? "failed"
              : "processing";
      const pi = id(session.payment_intent) || null;
      if (
        order.plan_key === "creditPack" &&
        session.payment_status === "paid" &&
        session.status === "complete"
      ) {
        if (!pi) throw new Review("missing_payment");
        const intent = await stripe.paymentIntents.retrieve(pi, {
          expand: ["latest_charge"],
        });
        if (
          intent.status !== "succeeded" ||
          id(intent.customer) !== customerId ||
          intent.currency !== p.currency ||
          intent.amount_received !== (session.amount_total ?? -1) ||
          intent.metadata.namespace !== state.namespace ||
          intent.metadata.order_id !== order.id
        )
          throw new Review("payment_mismatch");
        grant(`purchase:${order.id}`, p, "purchase", pi);
        const ch = intent.latest_charge;
        if (ch && typeof ch !== "string")
          await applyRisk(ch, `purchase:${order.id}`);
      }
      if (order.plan_key === "monthly" && id(session.subscription))
        await subscription(
          await stripe.subscriptions.retrieve(id(session.subscription)!),
        );
      statements.push(
        sql(
          "UPDATE billing_orders SET session_id=?,payment_intent=?,subscription_id=?,state=CASE WHEN EXISTS(SELECT 1 FROM entitlement_sources WHERE source_key='purchase:'||billing_orders.id AND state='reversed') THEN 'refunded' WHEN EXISTS(SELECT 1 FROM entitlement_sources WHERE source_key='purchase:'||billing_orders.id AND state='suspended') THEN 'review' ELSE ? END,url=NULL WHERE id=? AND $GUARD",
          [session.id, pi, id(session.subscription) || null, status, order.id],
        ),
      );
    } else if (object.object === "subscription") {
      const sub = await subscription(object);
      // Reconciliation also recovers paid invoices missed by webhooks. Enqueue separately to bound each execution.
      for await (const invoice of stripe.invoices.list({
        subscription: sub.id,
        limit: 10,
        status: "paid",
      })) {
        await enqueue(
          env,
          `reconcile:invoice:${invoice.id}`,
          "invoice.paid",
          invoice.id,
        );
        break;
      }
    } else if (object.object === "invoice") {
      const invoice = object,
        subId =
          invoice.parent?.type === "subscription_details"
            ? id(invoice.parent.subscription_details?.subscription)
            : undefined;
      if (!subId) throw new Review("invoice_without_subscription");
      await subscription(await stripe.subscriptions.retrieve(subId));
      if (invoice.status === "paid") {
        const lines = await stripe.invoices.listLineItems(invoice.id, {
          limit: 100,
        });
        if (
          lines.has_more ||
          lines.data.length !== 1 ||
          !["subscription_create", "subscription_cycle"].includes(
            invoice.billing_reason || "",
          ) ||
          invoice.collection_method !== "charge_automatically"
        )
          throw new Review("invoice_requires_review");
        const line = lines.data[0],
          priceId = id(line.pricing?.price_details?.price),
          p = priceId ? await price(priceId) : null;
        if (
          !p ||
          p.plan_key !== "monthly" ||
          line.quantity !== 1 ||
          line.parent?.subscription_item_details?.proration ||
          line.amount !== p.amount_minor ||
          invoice.currency !== p.currency ||
          invoice.subtotal !== p.amount_minor ||
          invoice.discounts?.length ||
          invoice.total_discount_amounts?.some((d) => d.amount > 0) ||
          line.discounts?.length ||
          line.discount_amounts?.some((d) => d.amount > 0) ||
          invoice.amount_paid !== invoice.total ||
          invoice.amount_due !== invoice.total ||
          invoice.amount_remaining !== 0
        )
          throw new Review("invoice_price");
        const payments = await stripe.invoicePayments.list({
          invoice: invoice.id,
          status: "paid",
          limit: 100,
        });
        if (
          payments.has_more ||
          payments.data.length !== 1 ||
          payments.data[0].payment.type !== "payment_intent" ||
          payments.data[0].currency !== invoice.currency ||
          payments.data[0].amount_paid !== invoice.amount_paid ||
          payments.data[0].amount_requested !== invoice.amount_due ||
          !payments.data[0].is_default
        )
          throw new Review("invoice_payment");
        const pi = id(payments.data[0].payment.payment_intent);
        if (!pi) throw new Review("invoice_payment");
        const intent = await stripe.paymentIntents.retrieve(pi, {
          expand: ["latest_charge"],
        });
        if (
          intent.status !== "succeeded" ||
          id(intent.customer) !== customerId ||
          intent.currency !== p.currency ||
          intent.amount_received !== invoice.amount_paid
        )
          throw new Review("invoice_payment_mismatch");
        const key = `invoice:${invoice.id}`;
        grant(
          key,
          p,
          "subscription",
          pi,
          line.period.start * 1000,
          line.period.end * 1000,
          subId,
        );
        const ch = intent.latest_charge;
        if (ch && typeof ch !== "string") await applyRisk(ch, key);
      }
    } else {
      const ch = object.object === "charge" ? object : charge!;
      if (
        id(ch.customer) !== customerId ||
        ch.livemode !== Boolean(state.livemode)
      )
        throw new Review("charge_mismatch");
      const pi = id(ch.payment_intent);
      if (!pi) throw new Review("missing_payment");
      let sources = (
        await env.DB.prepare(
          "SELECT * FROM entitlement_sources WHERE payment_intent=? AND user_id=?",
        )
          .bind(pi, customer.user_id)
          .all<Source>()
      ).results;
      if (!sources.length) {
        // Recover original grant from the owned purchase or invoice, then retry this event after it exists.
        const intent = await stripe.paymentIntents.retrieve(pi);
        const order = await env.DB.prepare(
          "SELECT * FROM billing_orders WHERE user_id=? AND (payment_intent=? OR id=?)",
        )
          .bind(
            customer.user_id,
            pi,
            intent.metadata.namespace === state.namespace
              ? intent.metadata.order_id || ""
              : "",
          )
          .first<Order>();
        if (order?.session_id)
          await enqueue(
            env,
            `reconcile:checkout:${order.session_id}`,
            "checkout.session.completed",
            order.session_id,
          );
        const payments = await stripe.invoicePayments.list({
          payment: { type: "payment_intent", payment_intent: pi },
          status: "paid",
          limit: 100,
        });
        if (payments.has_more || payments.data.length > 1)
          throw new Review("ambiguous_refund");
        for (const payment of payments.data)
          await enqueue(
            env,
            `reconcile:invoice:${id(payment.invoice)}`,
            "invoice.paid",
            id(payment.invoice)!,
          );
        throw new Error("source_pending");
      }
      if (sources.length !== 1) throw new Review("ambiguous_refund");
      const source = sources[0];
      await applyRisk(ch, source.source_key);
    }
    async function applyRisk(ch: Stripe.Charge, key: string) {
      if (ch.amount_refunded > 0 || ch.refunded) {
        const refunds = await stripe.refunds.list({
          charge: ch.id,
          limit: 100,
        });
        if (refunds.has_more) throw new Review("refund_pagination_review");
        const refunded = refunds.data
          .filter((r) => r.status === "succeeded")
          .reduce((sum, r) => sum + r.amount, 0);
        if (refunded >= ch.amount) {
          reverse(key);
          return;
        }
        if (refunded > 0) {
          reviewSource(key, "partial_refund", true, `refund:${refunded}`);
        }
      }
      const existing = await env.DB.prepare(
        "SELECT review_reason FROM entitlement_sources WHERE source_key=?",
      )
        .bind(key)
        .first<{ review_reason: string | null }>();
      if (
        ch.disputed ||
        object.object === "dispute" ||
        existing?.review_reason === "dispute"
      ) {
        const disputes = await stripe.disputes.list({
          charge: ch.id,
          limit: 100,
        });
        if (disputes.has_more || disputes.data.length > 1)
          throw new Review("dispute_review");
        const dispute = disputes.data[0];
        if (dispute?.status === "lost") {
          reverse(key, "dispute");
          reviewSource(key, "dispute_lost");
        } else if (
          dispute &&
          dispute.status !== "won" &&
          dispute.status !== "warning_closed"
        )
          reviewSource(
            key,
            "dispute",
            true,
            `dispute:${dispute.id}:${dispute.status}`,
          );
        else if (dispute)
          statements.push(
            sql(
              "UPDATE entitlement_sources SET state='active',review_reason=NULL WHERE source_key=? AND refunded=0 AND review_reason='dispute' AND $GUARD",
              [key],
            ),
          );
      }
    }
    function reverse(key: string, action = "refund") {
      statements.push(
        sql(
          "INSERT OR IGNORE INTO entitlement_ledger(operation_key,source_key,quantity,action,reason,created_at) SELECT ?,source_key,-remaining,?,'Provider source reversal',? FROM entitlement_sources WHERE source_key=? AND refunded=0 AND $GUARD",
          [`reverse:${key}`, action, Date.now(), key],
        ),
      );
      statements.push(
        sql(
          "UPDATE entitlement_sources SET state='reversed',review_reason=CASE WHEN remaining<credits THEN 'consumed_refund' ELSE NULL END,remaining=0,refunded=1 WHERE source_key=? AND refunded=0 AND $GUARD",
          [key],
        ),
      );
      statements.push(
        sql(
          "UPDATE billing_orders SET state=? WHERE 'purchase:'||id=? AND $GUARD",
          [action === "refund" ? "refunded" : "disputed", key],
        ),
      );
    }
    statements.push(
      sql(
        "UPDATE billing_events SET state='done',lease_until=0,error_code=NULL WHERE event_id=? AND $GUARD",
        [eventId],
      ),
    );
    await env.DB.batch(statements);
  } catch (error) {
    const review = error instanceof Review;
    await env.DB.prepare(
      "UPDATE billing_events SET state=?,error_code=?,lease_until=0,next_attempt_at=? WHERE event_id=? AND lease_token=? AND state='processing'",
    )
      .bind(
        review ? "review" : "retry",
        review ? error.code : "provider_or_lock_retry",
        Date.now() +
          Math.min(3600000, 1000 * 2 ** Math.min(event.attempts, 10)),
        eventId,
        eventToken,
      )
      .run();
  } finally {
    if (customer && token) await releaseCustomer(env, customer.user_id, token);
  }
}
export async function enqueue(
  env: Pick<Bindings, "DB">,
  eventId: string,
  type: string,
  objectId: string,
) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO billing_events(event_id,type,object_id,created_at) VALUES(?,?,?,?)",
  )
    .bind(eventId, type, objectId, Date.now())
    .run();
}
export async function grantInvoice(env: Bindings, invoiceId: string) {
  await enqueue(env, `grant:${invoiceId}`, "invoice.paid", invoiceId);
  await processEvent(env, `grant:${invoiceId}`);
}
export async function grantPurchase(env: Bindings, orderId: string) {
  const order = await env.DB.prepare(
    "SELECT session_id FROM billing_orders WHERE id=?",
  )
    .bind(orderId)
    .first<{ session_id: string | null }>();
  if (!order?.session_id) throw new Error("Order has no provider session");
  await enqueue(
    env,
    `grant:${orderId}`,
    "checkout.session.completed",
    order.session_id,
  );
  await processEvent(env, `grant:${orderId}`);
}
export async function maintainBilling(env: Bindings, limit = 10) {
  if (!limit) return { inspected: 0 };
  try {
    await operationalState(env);
  } catch {
    return { inspected: 0 };
  }
  // Split the bounded budget: inbox retries cannot starve canonical reconciliation.
  const due = (
    await env.DB.prepare(
      "SELECT subscription_id FROM billing_subscriptions WHERE reconcile_at<=? ORDER BY reconcile_at LIMIT ?",
    )
      .bind(Date.now(), Math.min(2, limit))
      .all<{ subscription_id: string }>()
  ).results;
  for (const sub of due) {
    await enqueue(
      env,
      `reconcile:sub:${sub.subscription_id}:${Math.floor(Date.now() / 3600000)}`,
      "customer.subscription.updated",
      sub.subscription_id,
    );
    await env.DB.prepare(
      "UPDATE billing_subscriptions SET reconcile_at=? WHERE subscription_id=?",
    )
      .bind(Date.now() + 3600000, sub.subscription_id)
      .run();
  }
  const orders = (
    await env.DB.prepare(
      "SELECT session_id FROM billing_orders WHERE state IN('open','processing') AND session_id IS NOT NULL AND reconcile_at<=? ORDER BY reconcile_at,created_at LIMIT ?",
    )
      .bind(Date.now(), Math.min(2, Math.max(0, limit - due.length)))
      .all<{ session_id: string }>()
  ).results;
  for (const order of orders) {
    await enqueue(
      env,
      `reconcile:checkout:${order.session_id}:${Math.floor(Date.now() / 600000)}`,
      "checkout.session.completed",
      order.session_id,
    );
    await env.DB.prepare(
      "UPDATE billing_orders SET reconcile_at=? WHERE session_id=?",
    )
      .bind(Date.now() + 600000, order.session_id)
      .run();
  }
  const sources = (
    await env.DB.prepare(
      "SELECT source_key,payment_intent FROM entitlement_sources WHERE kind!='free' AND state IN('active','suspended') AND payment_intent IS NOT NULL AND reconcile_at<=? AND (valid_until IS NULL OR valid_until>? OR state='suspended') ORDER BY reconcile_at,created_at LIMIT ?",
    )
      .bind(
        Date.now(),
        Date.now(),
        Math.min(2, Math.max(0, limit - due.length - orders.length)),
      )
      .all<{ source_key: string; payment_intent: string }>()
  ).results;
  for (const source of sources) {
    // PaymentIntent lookup recovers the canonical charge and checks refunds/disputes even when no callback arrived.
    await enqueue(
      env,
      `risk:${source.source_key}:${Math.floor(Date.now() / 3600000)}`,
      "app_starter.payment_risk",
      source.payment_intent,
    );
    await env.DB.prepare(
      "UPDATE entitlement_sources SET reconcile_at=? WHERE source_key=?",
    )
      .bind(Date.now() + 3600000, source.source_key)
      .run();
  }
  const events = (
    await env.DB.prepare(
      "SELECT event_id FROM billing_events WHERE (state IN('received','retry') AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?) ORDER BY created_at LIMIT ?",
    )
      .bind(
        Date.now(),
        Date.now(),
        Math.max(0, limit - due.length - orders.length - sources.length),
      )
      .all<{ event_id: string }>()
  ).results;
  for (const event of events) await processEvent(env, event.event_id);
  return {
    inspected: due.length + orders.length + sources.length + events.length,
  };
}
