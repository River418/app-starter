import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "../../shared/config";
let client: SupabaseClient | undefined;
let project = "";
export function configureAuth(config: PublicConfig) {
  if (!config.authReady) return;
  if (client && project === config.supabaseUrl) return client;
  project = config.supabaseUrl;
  client = createBrowserClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: location.protocol === "https:",
      },
    },
  );
  return client;
}
export function auth() {
  if (!client) throw new Error("Configure Supabase Auth first");
  return client;
}
