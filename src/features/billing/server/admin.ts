import { HTTPException } from "hono/http-exception";
import type { Bindings, Identity } from "../../../server/types";
import { claimCustomer, releaseCustomer } from "./checkout";
export async function reverseGrant(
  env: Bindings,
  sourceKey: string,
  operationId: string,
  actor: Identity,
  reason: string,
) {
  if (actor.role !== "admin" || reason.trim().length < 3)
    throw new HTTPException(403, {
      message: "Administrator and reason required",
    });
  const previous = await env.DB.prepare(
    "SELECT * FROM audit_log WHERE operation_id=?",
  )
    .bind(operationId)
    .first<{
      actor_id: string;
      target_id: string;
      reason: string;
      action: string;
    }>();
  if (previous) {
    if (
      previous.actor_id !== actor.userId ||
      previous.target_id !== sourceKey ||
      previous.reason !== reason ||
      previous.action !== "billing.reverse"
    )
      throw new HTTPException(409, { message: "Operation ID conflict" });
    return;
  }
  const source = await env.DB.prepare(
    "SELECT user_id FROM entitlement_sources WHERE source_key=?",
  )
    .bind(sourceKey)
    .first<{ user_id: string }>();
  if (!source) throw new HTTPException(404, { message: "Source not found" });
  const token = await claimCustomer(env, source.user_id);
  try {
    const guard =
      "EXISTS(SELECT 1 FROM billing_locks WHERE user_id=? AND lease_token=? AND lease_until>?)";
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO entitlement_ledger(operation_key,source_key,quantity,action,actor_id,reason,created_at) SELECT ?,source_key,-remaining,'reversal',?,?,? FROM entitlement_sources WHERE source_key=? AND state!='reversed' AND ${guard}`,
      ).bind(
        `reverse:${sourceKey}`,
        actor.userId,
        reason,
        Date.now(),
        sourceKey,
        source.user_id,
        token,
        Date.now(),
      ),
      env.DB.prepare(
        "INSERT INTO audit_log(id,operation_id,actor_id,target_id,action,reason,created_at) SELECT ?,?,?,?,'billing.reverse',?,? WHERE changes()=1",
      ).bind(
        crypto.randomUUID(),
        operationId,
        actor.userId,
        sourceKey,
        reason,
        Date.now(),
      ),
      env.DB.prepare(
        "UPDATE entitlement_sources SET remaining=0,state='reversed',refunded=1,review_reason=NULL WHERE source_key=? AND changes()=1",
      ).bind(sourceKey),
    ]);
    if (!results[0].meta.changes)
      throw new HTTPException(409, {
        message: "Source already reversed or lease expired",
      });
  } finally {
    await releaseCustomer(env, source.user_id, token);
  }
}
