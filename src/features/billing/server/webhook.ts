import Stripe from "stripe";
import { HTTPException } from "hono/http-exception";
import type { AppContext } from "../../../server/types";
import { stripeClient } from "./stripe";
import { enqueue, processEvent } from "./reconcile";
import type { BillingState } from "./catalog";
export const eventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;
export async function webhook(c: AppContext) {
  if (!c.env.STRIPE_WEBHOOK_SECRET)
    throw new HTTPException(503, { message: "Webhook not configured" });
  const signature = c.req.header("stripe-signature");
  if (!signature)
    throw new HTTPException(400, { message: "Missing signature" });
  let event: Stripe.Event;
  try {
    event = await stripeClient(c.env).webhooks.constructEventAsync(
      await c.req.text(),
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HTTPException(400, { message: "Invalid signature" });
  }
  const state = await c.env.DB.prepare(
    "SELECT * FROM billing_state WHERE id=1",
  ).first<BillingState>();
  if (
    !state ||
    event.livemode !== Boolean(state.livemode) ||
    event.livemode !== (c.env.APP_ENV === "prod")
  )
    throw new HTTPException(400, { message: "Wrong billing environment" });
  // This setup-only signed challenge verifies the deployed signing secret. It never creates a payment or entitlement.
  if ((event.type as string) === "app_starter.setup_probe") {
    const object = event.data.object as unknown as {
      namespace: string;
      nonce: string;
    };
    if (object.namespace !== state.namespace || !object.nonce)
      throw new HTTPException(400, { message: "Invalid setup probe" });
    return c.json({ nonce: object.nonce });
  }
  if (!(eventTypes as readonly string[]).includes(event.type))
    return c.json({ accepted: true });
  const object = event.data.object as { id?: string };
  if (!object.id) throw new HTTPException(400, { message: "Missing object" });
  await enqueue(c.env, event.id, event.type, object.id);
  await processEvent(c.env, event.id);
  const result = await c.env.DB.prepare(
    "SELECT state FROM billing_events WHERE event_id=?",
  )
    .bind(event.id)
    .first<{ state: string }>();
  // Review is durable and visible to admins. Transient processing failure preserves Stripe retries.
  return c.json({ accepted: true }, result?.state === "retry" ? 503 : 200);
}
