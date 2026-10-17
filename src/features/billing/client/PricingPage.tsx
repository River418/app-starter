import { useRef } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, json, ApiError } from "../../../client/lib/api";
import { Button } from "../../../client/components/ui";
import type { Catalog, PlanKey } from "../shared/contracts";
import type { Identity } from "../../../shared/identity";
export function PricingPage() {
  const { t, i18n } = useTranslation();
  const identity = useRouteLoaderData("app") as Identity | undefined;
  const catalog = useQuery({
    queryKey: ["billing", "catalog"],
    queryFn: () => api<Catalog>("/api/billing/catalog"),
  });
  const operations = useRef<Partial<Record<PlanKey, string>>>({});
  const buy = useMutation({
    mutationFn: async (key: PlanKey) => {
      const storageKey = `checkout:${identity?.userId}:${key}`;
      const operationId =
        operations.current[key] ||
        sessionStorage.getItem(storageKey) ||
        crypto.randomUUID();
      operations.current[key] = operationId;
      sessionStorage.setItem(storageKey, operationId);
      let response;
      try {
        response = await api<{ url: string }>("/api/billing/checkout", {
          method: "POST",
          body: json({ planKey: key, operationId }),
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === "CHECKOUT_EXPIRED") {
          sessionStorage.removeItem(storageKey);
          delete operations.current[key];
        }
        throw error;
      }
      sessionStorage.removeItem(storageKey);
      delete operations.current[key];
      window.location.assign(response.url);
    },
  });
  if (catalog.isPending) return <p role="status">{t("loading")}</p>;
  if (catalog.error) return <p role="alert">{catalog.error.message}</p>;
  const data = catalog.data;
  if (!data.enabled)
    return (
      <section>
        <h1>{t("billing.pricing")}</h1>
        <p>{t("billing.disabled")}</p>
      </section>
    );
  return (
    <section>
      <h1>{t("billing.pricing")}</h1>
      <p>
        {t(
          data.taxBehavior === "inclusive"
            ? "billing.taxInclusive"
            : "billing.taxExclusive",
        )}
      </p>
      {!data.ready && <p role="status">{t("billing.notReady")}</p>}
      <div className="billing-grid">
        {data.plans.map((plan) => (
          <article className="billing-card" key={plan.key}>
            <h2>{t(`billing.${plan.key}`)}</h2>
            <p className="billing-price">
              {new Intl.NumberFormat(i18n.language, {
                style: "currency",
                currency: data.currency,
              }).format(
                plan.amountMinor /
                  ([
                    "bif",
                    "clp",
                    "djf",
                    "gnf",
                    "jpy",
                    "kmf",
                    "krw",
                    "mga",
                    "pyg",
                    "rwf",
                    "vnd",
                    "vuv",
                    "xaf",
                    "xof",
                    "xpf",
                  ].includes(data.currency)
                    ? 1
                    : 100),
              )}
              {plan.key === "monthly" && <small> / {t("billing.month")}</small>}
            </p>
            <p>{t("billing.creditCount", { count: plan.credits })}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <p>
              {t(
                plan.key === "monthly"
                  ? "billing.periodRules"
                  : "billing.packRules",
              )}
            </p>
            {identity ? (
              <Button
                disabled={!data.ready || buy.isPending}
                onClick={() => buy.mutate(plan.key)}
              >
                {t("billing.purchase")}
              </Button>
            ) : (
              <Link className="button button-primary" to="/app/pricing">
                {t("billing.signInToPurchase")}
              </Link>
            )}
          </article>
        ))}
      </div>
      {buy.error && <p role="alert">{buy.error.message}</p>}
    </section>
  );
}
