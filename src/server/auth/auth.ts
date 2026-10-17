import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { HTTPException } from "hono/http-exception";
import { config } from "../config";
import type { AppContext, Identity } from "../types";

export function authClient(c: AppContext) {
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } = c.env;
  if (!url || !key)
    throw new HTTPException(503, { message: "Configure Supabase Auth first" });
  const jar = new Map(
    parseCookieHeader(c.req.header("Cookie") || "").map(({ name, value }) => [
      name,
      value || "",
    ]),
  );
  return createServerClient(url, key, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: c.env.APP_ORIGIN.startsWith("https:"),
    },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(values, headers) {
        for (const { name, value, options } of values) {
          jar.set(name, value);
          c.header("Set-Cookie", serializeCookieHeader(name, value, options), {
            append: true,
          });
        }
        for (const [name, value] of Object.entries(headers))
          c.header(name, value);
      },
    },
  });
}
export function adminAuth(c: AppContext) {
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SECRET_KEY)
    throw new HTTPException(503, {
      message: "Configure Supabase server secret",
    });
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function verifiedUser(c: AppContext) {
  const auth = authClient(c);
  const { data, error } = await auth.auth.getUser();
  if (
    error ||
    !data.user ||
    !data.user.email_confirmed_at ||
    data.user.is_anonymous
  )
    throw new HTTPException(401, {
      message: "Sign in with a verified account",
    });
  return { auth, user: data.user };
}
export async function requireIdentity(
  c: AppContext,
  admin = false,
): Promise<Identity> {
  const cached = c.get("identity");
  if (cached) {
    if (admin && cached.role !== "admin")
      throw new HTTPException(403, { message: "Application access denied" });
    return cached;
  }
  const { user } = await verifiedUser(c);
  if (config.authMode === "public") {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO members(user_id,email,role,status,created_at) VALUES(?,?,'member','active',?)",
    )
      .bind(user.id, user.email!, Date.now())
      .run();
  }
  const member = await c.env.DB.prepare(
    "SELECT user_id,email,role,status FROM members WHERE user_id=?",
  )
    .bind(user.id)
    .first<{
      user_id: string;
      email: string;
      role: "admin" | "member";
      status: string;
    }>();
  if (
    !member ||
    member.status !== "active" ||
    (admin && member.role !== "admin")
  )
    throw new HTTPException(403, { message: "Application access denied" });
  const identity = {
    userId: member.user_id,
    email: member.email,
    role: member.role,
  };
  c.set("identity", identity);
  return identity;
}
