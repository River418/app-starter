import Stripe from "stripe";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "../../../server/types";
export const apiVersion = "2026-09-30.endive" as const;
export function stripeClient(
  env: Pick<Bindings, "STRIPE_SECRET_KEY"> &
    Partial<Pick<Bindings, "STRIPE_TEST_API_URL" | "APP_ENV" | "APP_ORIGIN">>,
) {
  if (!env.STRIPE_SECRET_KEY)
    throw new HTTPException(503, {
      message: "Billing credentials not configured",
    });
  let local: { host: string; port: number; protocol: "http" } | undefined;
  if (env.STRIPE_TEST_API_URL) {
    const url = new URL(env.STRIPE_TEST_API_URL),
      origin = new URL(env.APP_ORIGIN || "https://invalid.example");
    if (
      !["test", "e2e", "local"].includes(env.APP_ENV || "") ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !["localhost", "127.0.0.1"].includes(origin.hostname) ||
      url.protocol !== "http:" ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      !env.STRIPE_SECRET_KEY.startsWith("sk_test_")
    )
      throw new HTTPException(503, {
        message: "Local Stripe substitute is forbidden for this environment",
      });
    local = {
      host: url.hostname,
      port: Number(url.port) || 80,
      protocol: "http",
    };
  }
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 1,
    timeout: 15000,
    ...local,
  });
}
export async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value),
    ),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function id(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}
