import { createHash } from "node:crypto";
export const apiVersion = "2026-09-30.endive";
export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export function resolveSigningSecret({
  provided,
  created,
  backup,
  expectedHash,
}) {
  const known = created || backup;
  if (provided && known && provided !== known)
    throw new Error(
      "Provided signing secret does not match the owned endpoint secret",
    );
  const value = provided || known;
  if (!value)
    throw new Error(
      "Restore the owned endpoint signing secret from Stripe Dashboard",
    );
  if (expectedHash && digest(value) !== expectedHash)
    throw new Error(
      "Signing-secret fingerprint mismatch; restore the original secret or perform an explicit endpoint repair",
    );
  return value;
}
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
];
const owned = (object, namespace) => {
  if (object.deleted || object.metadata?.namespace !== namespace)
    throw new Error("Stripe object ownership mismatch");
};
export async function syncCatalog(
  stripe,
  { slug, environment, billing, previous, save },
) {
  const account = await stripe.accounts.retrieveCurrent(),
    balance = await stripe.balance.retrieve();
  if (balance.livemode !== (environment === "prod"))
    throw new Error(
      "dev requires test mode; prod requires live mode. No setup was performed.",
    );
  const namespace = digest(
    `${slug}:${environment}:${account.id}:${balance.livemode}`,
  ).slice(0, 32);
  if (
    previous &&
    (previous.namespace !== namespace ||
      previous.account_id !== account.id ||
      Boolean(previous.livemode) !== balance.livemode)
  )
    throw new Error(
      "Stripe account/environment changed; use isolated D1 resources",
    );
  if (previous?.portal_id) {
    const p = await stripe.billingPortal.configurations.retrieve(
      previous.portal_id,
    );
    owned(p, namespace);
  }
  const prices = [];
  for (const plan of billing.plans) {
    const productId = `app_${namespace}_${plan.key}`,
      version = digest({
        ...plan,
        currency: billing.currency,
        taxBehavior: billing.taxBehavior,
      }),
      lookup = `${namespace}:${plan.key}:${version}`;
    let product;
    try {
      product = await stripe.products.retrieve(productId);
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    if (!product)
      product = await stripe.products.create(
        {
          id: productId,
          name: `${slug} ${plan.key}`,
          metadata: { namespace, app: slug, environment },
        },
        { idempotencyKey: `product:${productId}` },
      );
    owned(product, namespace);
    const existing = await stripe.prices.list({
      lookup_keys: [lookup],
      limit: 2,
    });
    let price = existing.data[0];
    if (existing.data.length > 1) throw new Error("Ambiguous price mapping");
    if (!price)
      price = await stripe.prices.create(
        {
          product: productId,
          currency: billing.currency,
          unit_amount: plan.amountMinor,
          tax_behavior: billing.taxBehavior,
          ...(plan.key === "monthly"
            ? { recurring: { interval: "month" } }
            : {}),
          lookup_key: lookup,
          metadata: { namespace, version, plan_key: plan.key },
        },
        { idempotencyKey: `price:${lookup}` },
      );
    owned(price, namespace);
    if (
      price.product !== productId ||
      price.currency !== billing.currency ||
      price.unit_amount !== plan.amountMinor ||
      price.metadata.version !== version ||
      price.tax_behavior !== billing.taxBehavior ||
      !price.active ||
      (plan.key === "monthly"
        ? price.recurring?.interval !== "month" ||
          price.recurring.interval_count !== 1
        : !!price.recurring)
    )
      throw new Error("Immutable Stripe price mismatch");
    prices.push({
      price_id: price.id,
      namespace,
      plan_key: plan.key,
      version,
      currency: billing.currency,
      amount_minor: plan.amountMinor,
      credits: plan.credits,
      features: JSON.stringify(plan.features),
      tax_behavior: billing.taxBehavior,
    });
  }
  let portalId = previous?.portal_id;
  if (!portalId) {
    const ownedPortals = [];
    for await (const portal of stripe.billingPortal.configurations.list({
      limit: 100,
    }))
      if (portal.metadata?.namespace === namespace) ownedPortals.push(portal);
    if (ownedPortals.length > 1)
      throw new Error(
        "Ambiguous owned Portal configurations; repair mapping before setup",
      );
    portalId = ownedPortals[0]?.id;
  }
  const params = {
    name: `${slug} (${environment})`,
    metadata: { namespace },
    default_return_url: `${save.origin}/app/billing`,
    login_page: { enabled: false },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: { enabled: false },
    },
  };
  if (!portalId)
    portalId = (
      await stripe.billingPortal.configurations.create(params, {
        idempotencyKey: `portal:${namespace}`,
      })
    ).id;
  else await stripe.billingPortal.configurations.update(portalId, params);
  const state = {
    origin: save.origin,
    namespace,
    account_id: account.id,
    livemode: balance.livemode ? 1 : 0,
    config_hash: digest(billing),
    portal_id: portalId,
    endpoint_id: previous?.endpoint_id || "",
    secret_hash: previous?.secret_hash || "",
    ready: 0,
  };
  await save(state, prices);
  return { state, prices };
}
