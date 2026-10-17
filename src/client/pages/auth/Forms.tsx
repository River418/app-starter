import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Link,
  useNavigate,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, Field, Input } from "../../components/ui";
import { auth } from "../../lib/auth";
import { api, json } from "../../lib/api";
import { queryClient } from "../../lib/query";
import type { PublicConfig } from "../../../shared/config";

const credentials = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
function CredentialsForm({
  signup = false,
  bootstrap = false,
}: {
  signup?: boolean;
  bootstrap?: boolean;
}) {
  const config = useRouteLoaderData("root") as PublicConfig;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof credentials>>({
    resolver: zodResolver(credentials),
  });
  const submit = handleSubmit(async (values) => {
    try {
      if ((signup || bootstrap) && values.password.length < 12)
        throw new Error(t("passwordPolicy"));
      if (bootstrap)
        await api("/api/auth/bootstrap", {
          method: "POST",
          body: json({ ...values, token: params.get("token") || "" }),
        });
      if (signup) {
        const result = await auth().auth.signUp({
          ...values,
          options: { emailRedirectTo: `${location.origin}/auth/confirm` },
        });
        if (result.error) throw result.error;
        setSent(true);
        return;
      }
      const result = await auth().auth.signInWithPassword(values);
      if (result.error) throw result.error;
      queryClient.clear();
      navigate("/app/records", { replace: true });
    } catch (error) {
      toast.error((error as Error).message);
    }
  });
  if (signup && config.authMode !== "public")
    return (
      <section className="auth-card">
        <h1>{t("signUp")}</h1>
        <p>{t("invitationNotice")}</p>
      </section>
    );
  return (
    <section className="auth-card">
      <span className="eyebrow">{config.title}</span>
      <h1>{t(bootstrap ? "bootstrap" : signup ? "signUp" : "welcome")}</h1>
      {!config.authReady ? (
        <p role="status">{t("setup")}</p>
      ) : sent ? (
        <p role="status">{t("emailSent")}</p>
      ) : (
        <form onSubmit={submit} className="stack">
          <Field id="email" label={t("email")} error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...register("email")}
              aria-invalid={!!errors.email}
            />
          </Field>
          <Field
            id="password"
            label={t("password")}
            error={errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete={
                signup || bootstrap ? "new-password" : "current-password"
              }
              {...register("password")}
              aria-invalid={!!errors.password}
            />
          </Field>
          {(signup || bootstrap) && (
            <p className="muted">{t("passwordPolicy")}</p>
          )}
          <Button disabled={isSubmitting} type="submit">
            {t(bootstrap ? "bootstrapSubmit" : signup ? "signUp" : "signIn")}
          </Button>
          {!bootstrap && (
            <div className="auth-links">
              <Link to={signup ? "/login" : "/reset-password"}>
                {t(signup ? "signIn" : "forgot")}
              </Link>
              {config.authMode === "public" && !signup && (
                <Link to="/sign-up">{t("signUp")}</Link>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  );
}
export function LoginPage() {
  return <CredentialsForm />;
}
export function SignUpPage() {
  return <CredentialsForm signup />;
}
export function BootstrapPage() {
  return <CredentialsForm bootstrap />;
}
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const config = useRouteLoaderData("root") as PublicConfig;
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.email() })),
  });
  return (
    <section className="auth-card">
      <h1>{t("reset")}</h1>
      {config.authMode !== "public" ? (
        <p>{t("invitationNotice")}</p>
      ) : sent ? (
        <p role="status">{t("emailSent")}</p>
      ) : (
        <form
          className="stack"
          onSubmit={handleSubmit(async ({ email }) => {
            try {
              const result = await auth().auth.resetPasswordForEmail(email, {
                redirectTo: `${location.origin}/auth/confirm`,
              });
              if (result.error) throw result.error;
              setSent(true);
            } catch (error) {
              toast.error((error as Error).message);
            }
          })}
        >
          <Field id="email" label={t("email")}>
            <Input id="email" type="email" {...register("email")} />
          </Field>
          <p className="muted">{t("mailNotice")}</p>
          <Button disabled={isSubmitting}>{t("reset")}</Button>
        </form>
      )}
      <Link to="/login">{t("signIn")}</Link>
    </section>
  );
}
export function ConfirmPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<{ password: string }>({
    resolver: zodResolver(z.object({ password: z.string().min(12).max(128) })),
  });
  const tokenHash = params.get("token_hash") || "";
  const type = params.get("type") || "email";
  useEffect(() => {
    const controller = new AbortController();
    setVerified(false);
    if (tokenHash)
      api<{ passwordRequired: boolean }>("/api/auth/resume", {
        method: "POST",
        body: json({ tokenHash }),
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setVerified(result.passwordRequired);
        })
        .catch(() => {});
    return () => controller.abort();
  }, [tokenHash]);
  return (
    <section className="auth-card">
      <h1>{t("confirmTitle")}</h1>
      {!verified ? (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api<{ passwordRequired: boolean }>(
                "/api/auth/confirm",
                { method: "POST", body: json({ tokenHash, type }) },
              );
              if (result.passwordRequired) setVerified(true);
              else {
                queryClient.clear();
                navigate("/app/records", { replace: true });
              }
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("confirm")}
        </Button>
      ) : (
        <form
          className="stack"
          onSubmit={handleSubmit(async ({ password }) => {
            try {
              await api("/api/auth/complete", {
                method: "POST",
                body: json({ tokenHash, password }),
              });
              queryClient.clear();
              navigate("/app/records", { replace: true });
            } catch (error) {
              toast.error((error as Error).message);
            }
          })}
        >
          <Field
            id="new-password"
            label={t("newPassword")}
            error={errors.password?.message}
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
          </Field>
          <p className="muted">{t("passwordPolicy")}</p>
          <Button disabled={isSubmitting}>{t("setPassword")}</Button>
        </form>
      )}
    </section>
  );
}
