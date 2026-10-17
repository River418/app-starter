import { HTTPException } from "hono/http-exception";
import { config } from "../../../server/config";
import type { Bindings } from "../../../server/types";
import type { Catalog, PlanKey } from "../shared/contracts";
import { hash } from "./stripe";
import { normalizeBilling } from "../../../shared/billing-config";
export interface BillingState {
  origin: string;
  namespace: string;
  account_id: string;
  livemode: number;
  config_hash: string;
  key_hash: string;
  portal_id: string;
  endpoint_id: string;
  secret_hash: string;
  ready: number;
}
export interface Price {
  price_id: string;
  namespace: string;
  plan_key: PlanKey;
  version: string;
  currency: string;
  amount_minor: number;
  credits: number;
  features: string;
  tax_behavior: string;
}
export function settings() {
  return normalizeBilling(config.billing);
}
export async function readyState(env: Bindings) {
  const state = await operationalState(env);
  if (!settings().enabled || state.config_hash !== (await hash(settings())))
    throw new HTTPException(503, { message: "Billing setup is not ready" });
  return state;
}
export async function operationalState(env: Bindings) {
  const state = await env.DB.prepare(
    "SELECT * FROM billing_state WHERE id=1",
  ).first<BillingState>();
  if (
    !state?.ready ||
    state.origin !== env.APP_ORIGIN ||
    state.namespace !==
      (
        await hash(
          `${config.slug}:${env.APP_ENV}:${state.account_id}:${Boolean(state.livemode)}`,
        )
      ).slice(0, 32) ||
    !env.STRIPE_SECRET_KEY ||
    !env.STRIPE_WEBHOOK_SECRET ||
    state.key_hash !== (await hash(env.STRIPE_SECRET_KEY)) ||
    state.secret_hash !== (await hash(env.STRIPE_WEBHOOK_SECRET)) ||
    Boolean(state.livemode) !== (env.APP_ENV === "prod")
  )
    throw new HTTPException(503, { message: "Billing setup is not ready" });
  return state;
}
export async function catalog(env: Bindings): Promise<Catalog> {
  const b = settings();
  let ready = false;
  try {
    await readyState(env);
    ready = true;
  } catch {
    /* public readiness never exposes credentials */
  }
  return {
    enabled: b.enabled,
    ready,
    currency: b.currency,
    taxBehavior: b.taxBehavior,
    automaticTax: b.automaticTax,
    plans: b.plans,
  };
}
export async function currentPrice(
  env: Bindings,
  key: PlanKey,
  state: BillingState,
) {
  const plan = settings().plans.find((p) => p.key === key);
  if (!plan) throw new HTTPException(400, { message: "Unknown plan" });
  const version = await hash({
    ...plan,
    currency: settings().currency,
    taxBehavior: settings().taxBehavior,
  });
  const price = await env.DB.prepare(
    "SELECT * FROM billing_prices WHERE namespace=? AND plan_key=? AND version=?",
  )
    .bind(state.namespace, key, version)
    .first<Price>();
  if (!price)
    throw new HTTPException(503, { message: "Price mapping not ready" });
  return price;
}
