import type { BillingConfig } from "./config";
export function normalizeBilling(b?: BillingConfig) {
  const value = {
    enabled: !!b?.enabled,
    currency: b?.currency?.toLowerCase() || "usd",
    taxBehavior: b?.taxBehavior || "exclusive",
    automaticTax: !!b?.automaticTax,
    freeCredits: b?.freeCredits || 0,
    freeFeatures: [...(b?.freeFeatures || [])].sort(),
    plans: (["monthly", "creditPack"] as const).flatMap((key) =>
      b?.[key]
        ? [{ key, ...b[key], features: [...(b[key].features || [])].sort() }]
        : [],
    ),
  };
  if (
    !/^[a-z]{3}$/.test(value.currency) ||
    !Number.isSafeInteger(value.freeCredits) ||
    value.freeCredits < 0 ||
    value.plans.some(
      (p) =>
        !Number.isSafeInteger(p.amountMinor) ||
        p.amountMinor <= 0 ||
        !Number.isSafeInteger(p.credits) ||
        p.credits < 0 ||
        p.features.some((f) => !/^[a-zA-Z0-9_.-]{1,80}$/.test(f)),
    )
  )
    throw new Error("Invalid billing config");
  return value;
}
