import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../client/lib/api";
export function PaymentReturnPage() {
  const [params] = useSearchParams();
  return <Status key={params.get("order")} order={params.get("order") || ""} />;
}
function Status({ order }: { order: string }) {
  const { t } = useTranslation(),
    client = useQueryClient();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), 60000);
    return () => clearTimeout(timer);
  }, []);
  const result = useQuery({
    queryKey: ["billing", "return", order],
    queryFn: () =>
      api<{ state: string; confirmed: boolean }>(
        `/api/billing/orders/${encodeURIComponent(order)}`,
      ),
    enabled: !!order && !expired,
    refetchInterval: (query) =>
      expired ||
      query.state.data?.confirmed ||
      ["failed", "expired"].includes(query.state.data?.state || "")
        ? false
        : 2000,
    retry: false,
  });
  const confirmed = result.data?.confirmed;
  useEffect(() => {
    if (confirmed)
      void client.invalidateQueries({ queryKey: ["billing", "account"] });
  }, [confirmed, client]);
  const failed = ["failed", "expired"].includes(result.data?.state || "");
  return (
    <section>
      <h1>{t("billing.returnTitle")}</h1>
      <p role="status">
        {t(
          !order
            ? "billing.missingOrder"
            : confirmed
              ? "billing.confirmed"
              : failed
                ? "billing.paymentFailed"
                : expired
                  ? "billing.pendingLater"
                  : "billing.pending",
        )}
      </p>
      {result.error && <p role="alert">{result.error.message}</p>}
      <Link to="/app/billing">{t("billing.title")}</Link>
    </section>
  );
}
