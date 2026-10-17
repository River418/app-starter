import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, json } from "../../../client/lib/api";
import { Button, Field, Input } from "../../../client/components/ui";
interface AdminData {
  orders: { id: string; user_id: string; state: string; plan_key: string }[];
  subscriptions: { subscription_id: string; user_id: string; status: string }[];
  events: {
    event_id: string;
    type: string;
    state: string;
    error_code: string;
  }[];
  sources: {
    source_key: string;
    user_id: string;
    remaining: number;
    state: string;
    review_reason: string | null;
  }[];
}
export function AdminBillingPage() {
  const { t } = useTranslation(),
    client = useQueryClient();
  const [owner, setOwner] = useState(""),
    [filter, setFilter] = useState(""),
    [reason, setReason] = useState(""),
    [source, setSource] = useState(""),
    [quantity, setQuantity] = useState(""),
    [object, setObject] = useState("");
  const [operation, setOperation] = useState<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const [resume, setResume] = useState(false);
  const data = useQuery({
    queryKey: ["billing", "admin", filter],
    queryFn: () =>
      api<AdminData>(
        `/api/admin/billing${filter ? `?userId=${encodeURIComponent(filter)}` : ""}`,
      ),
  });
  const action = useMutation({
    mutationFn: async ({
      kind,
      params,
    }: {
      kind: string;
      params: Record<string, unknown>;
    }) => {
      const fingerprint = JSON.stringify({ kind, ...params, reason }),
        operationId =
          operation?.fingerprint === fingerprint
            ? operation.id
            : crypto.randomUUID();
      setOperation({ fingerprint, id: operationId });
      await api(`/api/admin/billing/${kind}`, {
        method: "POST",
        body: json({ ...params, reason, operationId }),
      });
      setOperation(null);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["billing"] }),
  });
  return (
    <section>
      <h1>{t("billing.admin")}</h1>
      <form
        className="page-actions"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(owner);
        }}
      >
        <Field id="billing-owner" label={t("billing.userId")}>
          <Input
            id="billing-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </Field>
        <Button>{t("billing.filter")}</Button>
      </form>
      <Field id="billing-reason" label={t("billing.reason")}>
        <Input
          id="billing-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={3}
          maxLength={500}
        />
      </Field>
      {action.error && <p role="alert">{action.error.message}</p>}
      {action.isSuccess && <p role="status">{t("billing.operationSaved")}</p>}
      {data.error && <p role="alert">{data.error.message}</p>}
      <h2>{t("billing.pendingEvents")}</h2>
      {data.data?.events.map((e) => (
        <article className="billing-card" key={e.event_id}>
          <p>
            {e.event_id} · {e.type} · {e.state} · {e.error_code}
          </p>
          <Button
            disabled={action.isPending || reason.trim().length < 3}
            onClick={() =>
              action.mutate({ kind: "retry", params: { eventId: e.event_id } })
            }
          >
            {t("billing.retry")}
          </Button>
        </article>
      ))}
      <h2>{t("billing.reconcile")}</h2>
      <form
        className="page-actions"
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate({ kind: "reconcile", params: { objectId: object } });
        }}
      >
        <Field id="billing-object" label={t("billing.objectId")}>
          <Input
            id="billing-object"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            required
          />
        </Field>
        <Button disabled={action.isPending || reason.trim().length < 3}>
          {t("billing.reconcile")}
        </Button>
      </form>
      <h2>{t("billing.adjust")}</h2>
      <form
        className="page-actions"
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate({
            kind: "adjust",
            params: {
              sourceKey: source,
              quantity: Number(quantity),
              ...(resume ? { resolution: "resume" } : {}),
            },
          });
        }}
      >
        <Field id="billing-source" label={t("billing.source")}>
          <Input
            id="billing-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
          />
        </Field>
        <Field id="billing-quantity" label={t("billing.quantity")}>
          <Input
            id="billing-quantity"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={resume}
            onChange={(e) => setResume(e.target.checked)}
          />
          {t("billing.resume")}
        </label>
        <Button disabled={action.isPending || reason.trim().length < 3}>
          {t("billing.adjust")}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={action.isPending || !source || reason.trim().length < 3}
          onClick={() =>
            action.mutate({ kind: "reverse", params: { sourceKey: source } })
          }
        >
          {t("billing.reverse")}
        </Button>
      </form>
      <h2>{t("billing.orders")}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>{t("billing.userId")}</th>
              <th>{t("billing.plan")}</th>
              <th>{t("billing.status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.orders.map((o) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{o.user_id}</td>
                <td>{o.plan_key}</td>
                <td>{o.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>{t("billing.subscriptions")}</h2>
      {data.data?.subscriptions.map((s) => (
        <p key={s.subscription_id}>
          {s.subscription_id} · {s.user_id} · {s.status}
        </p>
      ))}
      <h2>{t("billing.sources")}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("billing.source")}</th>
              <th>{t("billing.userId")}</th>
              <th>{t("billing.remaining")}</th>
              <th>{t("billing.status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.sources.map((s) => (
              <tr key={s.source_key}>
                <td>{s.source_key}</td>
                <td>{s.user_id}</td>
                <td>{s.remaining}</td>
                <td>
                  {s.state} {s.review_reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
