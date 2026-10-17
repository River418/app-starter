import config from "../../app.config";
import type { PublicConfig } from "../shared/config";
import type { Bindings } from "./types";

export function readPublicConfig(env: Bindings): PublicConfig {
  return {
    billingEnabled: Boolean(config.billing?.enabled),
    slug: config.slug,
    title: config.title,
    preset: config.preset,
    authMode: config.authMode,
    maxFileBytes: config.maxFileBytes,
    environment: env.APP_ENV,
    authReady: Boolean(
      env.SUPABASE_URL &&
      env.SUPABASE_PUBLISHABLE_KEY &&
      env.SUPABASE_SECRET_KEY,
    ),
    supabaseUrl: env.SUPABASE_URL || "",
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
  };
}
export { config };
