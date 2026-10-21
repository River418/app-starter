import type { PublicConfig } from "../../shared/config";

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let activeId: string | undefined;
let previousLocation: string | undefined;

function safeLocation(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? `${url.origin}${url.pathname}`
      : "";
  } catch {
    return "";
  }
}

export function trackPageView(config: PublicConfig, pathname: string): void {
  const id = config.analytics?.googleAnalyticsId;
  if (config.environment !== "prod" || !id || !/^G-[A-Z0-9]+$/.test(id)) return;

  const pageLocation = safeLocation(`${window.location.origin}${pathname}`);
  if (activeId === id && previousLocation === pageLocation) return;
  const parameters = {
    page_location: pageLocation,
    page_title: config.title,
    page_referrer: previousLocation ?? safeLocation(document.referrer),
  };

  window.dataLayer ??= [];
  window.gtag ??= function () {
    window.dataLayer!.push(arguments);
  };
  // Set safe defaults before initialization and any automatic SDK events.
  window.gtag("set", parameters);
  if (activeId !== id) {
    window.gtag("js", new Date());
    window.gtag("config", id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(script);
    activeId = id;
  }
  window.gtag("event", "page_view", { ...parameters, send_to: id });
  previousLocation = pageLocation;
}
