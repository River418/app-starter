import { env } from "cloudflare:workers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { afterEach } from "vitest";
import { app } from "../../src/server/app";

const created = new Set<string>();
export const password = "Testing-Only-Password-879!";
export function adminClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new Error(
      "Start isolated local Supabase and save status before Auth tests (see README)",
    );
  if (!["localhost", "127.0.0.1"].includes(new URL(env.SUPABASE_URL).hostname))
    throw new Error("Integration tests require isolated local Auth");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
afterEach(async () => {
  if (!created.size) return;
  for (const id of created) {
    const { error } = await adminClient().auth.admin.deleteUser(id);
    if (error) throw error;
  }
  created.clear();
});
export function trackUser(id: string) {
  created.add(id);
}
export async function user(role: "admin" | "member" = "member", seed = true) {
  const email = `starter-${crypto.randomUUID()}@example.test`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error || new Error("User missing");
  trackUser(data.user.id);
  if (seed)
    await env.DB.prepare(
      "INSERT INTO members (user_id,email,role,status,created_at) VALUES (?,?,?,'active',?)",
    )
      .bind(data.user.id, email, role, Date.now())
      .run();
  const cookies = new Map<string, string>();
  const auth = createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (values) => {
          for (const v of values) cookies.set(v.name, v.value);
        },
      },
    },
  );
  const signIn = await auth.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return {
    id: data.user.id,
    email,
    cookies,
    cookie: () =>
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  };
}
export async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = {
    Origin: "http://localhost:5173",
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(options.body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
    ...options.headers,
  };
  return app.request(
    `http://localhost:5173${path}`,
    {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    env,
  );
}
export function responseCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => {
      const pair = value.split(";")[0];
      const [cookie] = parseCookieHeader(pair);
      return `${cookie.name}=${cookie.value}`;
    })
    .join("; ");
}
