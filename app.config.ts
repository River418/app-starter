import type { AppConfig } from "./src/shared/config";

const config: AppConfig = {
  slug: "app-starter",
  title: "App Starter",
  preset: "web",
  authMode: "invite",
  maxFileBytes: 10 * 1024 * 1024,
  analytics: { googleAnalyticsId: "" },
};
export default config;
