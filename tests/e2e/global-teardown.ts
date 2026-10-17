import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
export default async function teardown() {
  const auth = JSON.parse(readFileSync(".local/supabase-status.json", "utf8"));
  if (!["localhost", "127.0.0.1"].includes(new URL(auth.API_URL).hostname))
    throw new Error("Refuse nonlocal test cleanup");
  const admin = createClient(
    auth.API_URL,
    auth.SECRET_KEY || auth.SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const user of data.users)
    if (user.email?.startsWith("starter-e2e-")) {
      const result = await admin.auth.admin.deleteUser(user.id);
      if (result.error) throw result.error;
    }
}
