import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../client/lib/api";
import { Button } from "../../../client/components/ui";
import type { Entitlements } from "../shared/contracts";
interface Account {
  entitlements: Entitlements;
  orders: { id: string; plan_key: string; state: string; created_at: number }[];
  subscriptions: {
    subscription_id: string;
    status: string;
    period_end: number;
    cancel_at_period_end: number;
  }[];
}
export function BillingPage() {
  const { t } = useTranslation();
  const account = useQuery({
    queryKey: ["billing", "account"],
    queryFn: () => api<Account>("/api/billing"),
  });
  const portal = useMutation({
    mutationFn: async () => {
      const { url } = await api<{ url: string }>("/api/billing/portal", {
        method: "POST",
      });
      window.location.assign(url);
    },
  });
  if (account.isPending) return <p role="status">{t("loading")}</p>;
  if (account.error) return <p role="alert">{account.error.message}</p>;
  const { entitlements: e, orders, subscriptions } = account.data;
  return (
    <section>
      <h1>{t("billing.title")}</h1>
      <div className="page-actions">
        <Link to="/app/pricing">{t("billing.pricing")}</Link>
        <Button
          variant="secondary"
          disabled={portal.isPending}
          onClick={() => portal.mutate()}
        >
          {t("billing.portal")}
        </Button>
      </div>
      {portal.error && <p role="alert">{portal.error.message}</p>}
      <div className="billing-grid">
        {(["free", "subscription", "purchased"] as const).map((key) => (
          <article className="billing-card" key={key}>
            <h2>{t(`billing.${key}`)}</h2>
            <p className="billing-price">{e[key]}</p>
          </article>
        ))}
      </div>
      <p>{t("billing.total", { count: e.credits })}</p>
      <p>
        {t("billing.features")}: {e.features.join(", ") || "—"}
      </p>
      <h2>{t("billing.subscriptions")}</h2>
      {subscriptions.length ? (
        subscriptions.map((s) => (
          <p key={s.subscription_id}>
            {s.status} · {t("billing.validUntil")}{" "}
            {new Date(s.period_end).toLocaleString()}{" "}
            {s.cancel_at_period_end ? `· ${t("billing.cancelsAtEnd")}` : ""}
          </p>
        ))
      ) : (
        <p>{t("billing.none")}</p>
      )}
      <h2>{t("billing.orders")}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("billing.date")}</th>
              <th>{t("billing.plan")}</th>
              <th>{t("billing.status")}</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.created_at).toLocaleString()}</td>
                <td>{t(`billing.${o.plan_key}`)}</td>
                <td>{o.state}</td>
                <td>
                  <Link
                    to={`/app/billing/return?order=${encodeURIComponent(o.id)}`}
                  >
                    {o.id.slice(0, 8)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!orders.length && <p>{t("billing.none")}</p>}
      </div>
      {e.sources
        .filter((s) => s.reviewReason)
        .map((s) => (
          <p role="status" key={s.sourceKey}>
            {t("billing.review")}: {s.sourceKey} ({s.reviewReason})
          </p>
        ))}
    </section>
  );
}
