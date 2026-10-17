import { useEffect, useRef, useState } from "react";
import {
  Outlet,
  useLoaderData,
  useRevalidator,
  useRouteLoaderData,
  Link,
} from "react-router";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { Sun, Moon, Globe } from "lucide-react";
import { configureAuth } from "../lib/auth";
import { queryClient } from "../lib/query";
import { Button } from "../components/ui";
import type { PublicConfig } from "../../shared/config";

export function Controls() {
  const { t, i18n } = useTranslation();
  return (
    <div className="controls">
      <Button
        variant="ghost"
        aria-label={t("theme")}
        onClick={() => {
          const next =
            document.documentElement.dataset.theme === "dark"
              ? "light"
              : "dark";
          document.documentElement.dataset.theme = next;
          localStorage.setItem("theme", next);
        }}
      >
        <Sun className="sun" size={18} />
        <Moon className="moon" size={18} />
      </Button>
      <Button
        variant="ghost"
        aria-label={t("language")}
        onClick={() => {
          const next = i18n.language === "en" ? "zh-CN" : "en";
          i18n.changeLanguage(next);
          localStorage.setItem("language", next);
          document.documentElement.lang = next;
        }}
      >
        <Globe size={18} />
        <span>{i18n.language === "en" ? "EN" : "中"}</span>
      </Button>
    </div>
  );
}
export function Root() {
  const config = useLoaderData() as PublicConfig;
  const revalidator = useRevalidator();
  const previous = useRef<string | null | undefined>(undefined);
  const [changingIdentity, setChangingIdentity] = useState(false);
  useEffect(() => {
    document.title = config.title;
    const client = configureAuth(config);
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const subject = session?.user.id || null;
      const changed =
        previous.current !== undefined && previous.current !== subject;
      previous.current = subject;
      if (changed) {
        queryClient.clear();
        setChangingIdentity(true);
        queueMicrotask(async () => {
          try {
            await revalidator.revalidate();
          } finally {
            setChangingIdentity(false);
          }
        });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [config, revalidator.revalidate]);
  return (
    <>
      {changingIdentity ? (
        <p role="status" className="hero">
          Loading…
        </p>
      ) : (
        <Outlet />
      )}
      <Toaster richColors position="bottom-right" />
    </>
  );
}
export function PublicLayout() {
  const config = useRouteLoaderData("root") as PublicConfig | undefined;
  return (
    <div className="public-shell">
      <header>
        <Link className="brand" to="/">
          {config?.title || "App Starter"}
        </Link>
        <Controls />
      </header>
      <Outlet />
    </div>
  );
}
