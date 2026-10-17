import type { Bindings } from "../../../server/types";
import type { Entitlements } from "../shared/contracts";
import { settings } from "./catalog";
import { HTTPException } from "hono/http-exception";
export async function requireFeature(
  env: Pick<Bindings, "DB">,
  userId: string,
  feature: string,
) {
  if (!(await getEntitlements(env, userId)).features.includes(feature))
    throw new HTTPException(403, { message: "Feature entitlement required" });
}
export interface Source {
  source_key: string;
  user_id: string;
  kind: string;
  price_id: string | null;
  payment_intent: string | null;
  credits: number;
  remaining: number;
  features: string;
  valid_from: number;
  valid_until: number | null;
  state: string;
  review_reason: string | null;
  refunded: number;
}
export async function getEntitlements(
  env: Pick<Bindings, "DB">,
  userId: string,
): Promise<Entitlements> {
  const b = settings();
  const now = Date.now();
  if (b.freeCredits || b.freeFeatures.length)
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO entitlement_sources(source_key,user_id,kind,credits,remaining,features,created_at) VALUES(?,?,'free',?,?,?,?)",
      ).bind(
        `free:${userId}`,
        userId,
        b.freeCredits,
        b.freeCredits,
        JSON.stringify(b.freeFeatures),
        now,
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO entitlement_ledger(operation_key,source_key,quantity,action,created_at) VALUES(?,?,?,'grant',?)",
      ).bind(`free:${userId}`, `free:${userId}`, b.freeCredits, now),
    ]);
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM entitlement_sources WHERE user_id=? ORDER BY created_at DESC LIMIT 200",
    )
      .bind(userId)
      .all<Source>()
  ).results;
  // Balance includes all sources; only the detail view is bounded.
  const totals = (
    await env.DB.prepare(
      "SELECT kind,sum(remaining) AS balance FROM entitlement_sources WHERE user_id=? AND state='active' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) GROUP BY kind",
    )
      .bind(userId, now, now)
      .all<{ kind: string; balance: number }>()
  ).results;
  const featureRows = (
    await env.DB.prepare(
      "SELECT DISTINCT features FROM entitlement_sources WHERE user_id=? AND state='active' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?)",
    )
      .bind(userId, now, now)
      .all<{ features: string }>()
  ).results;
  const free = totals.find((x) => x.kind === "free")?.balance || 0,
    subscription = totals.find((x) => x.kind === "subscription")?.balance || 0,
    purchased = totals.find((x) => x.kind === "purchase")?.balance || 0;
  return {
    credits: free + subscription + purchased,
    free,
    subscription,
    purchased,
    features: [
      ...new Set(
        featureRows.flatMap((x) => JSON.parse(x.features) as string[]),
      ),
    ],
    sources: rows.map((s) => ({
      sourceKey: s.source_key,
      kind: s.kind,
      remaining: s.remaining,
      validUntil: s.valid_until,
      state: s.state,
      reviewReason: s.review_reason,
    })),
  };
}
