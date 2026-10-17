import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, json } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { Button, Field, Input } from "../../components/ui";

interface Member {
  userId: string;
  email: string;
  role: string;
  status: string;
}
interface Issued {
  link: string;
  actionId: string;
}
const inviteSchema = z.object({
  email: z.email(),
  reason: z.string().trim().min(3).max(500),
});
export function UsersPage() {
  const { t } = useTranslation();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [page, setPage] = useState(1);
  const operation = useRef(crypto.randomUUID());
  const users = useQuery({
    queryKey: ["admin-users", page],
    queryFn: () => api<{ items: Member[] }>(`/api/admin/users?page=${page}`),
  });
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
  });
  const issue = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api<Issued>(path, { method: "POST", body: json(body) }),
    onSuccess: async (result) => {
      setIssued(result);
      operation.current = crypto.randomUUID();
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error) => {
      operation.current = crypto.randomUUID();
      toast.error(error.message);
    },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("admin")}</span>
          <h1>{t("users")}</h1>
        </div>
      </div>
      <div className="admin-grid">
        <section className="panel">
          <h2>{t("invite")}</h2>
          <form
            className="stack"
            onSubmit={form.handleSubmit((values) =>
              issue.mutate({
                path: "/api/admin/invitations",
                body: { ...values, operationId: operation.current },
              }),
            )}
          >
            <Field
              id="invite-email"
              label={t("inviteEmail")}
              error={form.formState.errors.email?.message}
            >
              <Input
                id="invite-email"
                type="email"
                {...form.register("email")}
              />
            </Field>
            <Field
              id="reason"
              label={t("reason")}
              error={form.formState.errors.reason?.message}
            >
              <Input id="reason" {...form.register("reason")} />
            </Field>
            <Button disabled={issue.isPending}>{t("invite")}</Button>
          </form>
          {issued && (
            <div className="issued-link stack">
              <p>{t("linkNotice")}</p>
              <Field id="issued-link" label={t("oneTimeLink")}>
                <Input id="issued-link" value={issued.link} readOnly />
              </Field>
              <div className="row">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(issued.link);
                      toast.success(t("copy"));
                    } catch {
                      toast.error("Select and copy the link manually");
                    }
                  }}
                >
                  {t("copy")}
                </Button>
                {new URL(issued.link).searchParams.get("type") === "invite" && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const reason = form.getValues("reason");
                        await api(
                          `/api/admin/actions/${issued.actionId}/revoke`,
                          {
                            method: "POST",
                            body: json({
                              operationId: crypto.randomUUID(),
                              reason,
                            }),
                          },
                        );
                        setIssued(null);
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    {t("revoke")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
        <section className="panel users-panel">
          {users.isPending ? (
            <p role="status">{t("loading")}</p>
          ) : users.error ? (
            <p role="alert">{users.error.message}</p>
          ) : (
            <>
              <div className="user-list">
                {users.data.items.map((user) => (
                  <div className="user-row" key={user.userId}>
                    <div>
                      <strong>{user.email}</strong>
                      <p className="muted">
                        {user.role} · {user.status}
                      </p>
                    </div>
                    {["active", "pending"].includes(user.status) && (
                      <Button
                        variant="secondary"
                        disabled={issue.isPending}
                        onClick={() => {
                          const reason = form.getValues("reason");
                          if (!reason || reason.trim().length < 3) {
                            form.setError("reason", { message: t("reason") });
                            return;
                          }
                          issue.mutate({
                            path: `/api/admin/users/${user.userId}/recovery`,
                            body: { reason, operationId: operation.current },
                          });
                        }}
                      >
                        {t("recover")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="pagination">
                <Button
                  variant="ghost"
                  disabled={page === 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  {t("previous")}
                </Button>
                <span>{page}</span>
                <Button
                  variant="ghost"
                  disabled={users.data.items.length < 50}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
