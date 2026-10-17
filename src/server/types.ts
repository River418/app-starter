import type { Context } from "hono";
export interface Bindings {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;
  APP_ENV: string;
  APP_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_TEST_API_URL?: string;
  RESEND_API_KEY?: string;
}
export interface Identity {
  userId: string;
  email: string;
  role: "admin" | "member";
}
export type AppEnv = { Bindings: Bindings; Variables: { identity: Identity } };
export type AppContext = Context<AppEnv>;
