import {
  Link,
  isRouteErrorResponse,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { useTranslation } from "react-i18next";
import type { PublicConfig } from "../../shared/config";
export function HomePage() {
  const config = useRouteLoaderData("root") as PublicConfig;
  const { t } = useTranslation();
  return (
    <main className="hero">
      <span className="eyebrow">{config.title}</span>
      <h1>{t("homeTitle")}</h1>
      <p>{t("homeDescription")}</p>
      <Link className="button button-primary" to="/app/records">
        {t("getStarted")} →
      </Link>
    </main>
  );
}
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main className="hero">
      <span className="eyebrow">404</span>
      <h1>{t("notFound")}</h1>
      <Link to="/app/records">{t("back")}</Link>
    </main>
  );
}
export function ErrorPage() {
  const error = useRouteError();
  const { t } = useTranslation();
  const message = isRouteErrorResponse(error)
    ? String(error.data)
    : error instanceof Error
      ? error.message
      : t("errorTitle");
  return (
    <main className="hero">
      <h1>{t("errorTitle")}</h1>
      <p role="alert">{message}</p>
      <Link to="/app/records">{t("back")}</Link>
    </main>
  );
}
