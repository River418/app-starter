import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runTool } from "./process.mjs";
const root = process.cwd();
const statePath = resolve(".local/e2e-workers");
if (
  statePath !== resolve(root, ".local", "e2e-workers") ||
  !statePath.startsWith(root)
)
  throw new Error("Invalid test persistence path");
await rm(statePath, { recursive: true, force: true });
await mkdir(".local", { recursive: true });
const auth = JSON.parse(await readFile(".local/supabase-status.json", "utf8"));
if (!new URL(auth.API_URL).hostname.match(/^(localhost|127\.0\.0\.1)$/))
  throw new Error("E2E setup requires the isolated local Auth project");
await writeFile(
  ".dev.vars.e2e",
  `SUPABASE_URL="http://localhost:55321"\nSUPABASE_PUBLISHABLE_KEY="${auth.PUBLISHABLE_KEY || auth.ANON_KEY}"\nSUPABASE_SECRET_KEY="${auth.SECRET_KEY || auth.SERVICE_ROLE_KEY}"\n`,
);
const runId = randomUUID();
const token = randomUUID();
const password = "E2E-Local-Password-349!";
const users = {
  runId,
  bootstrapToken: token,
  admin: { email: `starter-e2e-${runId}-admin@example.test`, password },
  member: { email: `starter-e2e-${runId}-member@example.test`, password },
};
const admin = createClient(
  auth.API_URL,
  auth.SECRET_KEY || auth.SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const created = await admin.auth.admin.createUser({
  email: users.member.email,
  password,
  email_confirm: true,
});
if (created.error) throw created.error;
await writeFile(".local/e2e-users.json", JSON.stringify(users));
const args = ["--env", "e2e", "--local", "--persist-to", ".local/e2e-workers"];
await runTool("wrangler", ["d1", "migrations", "apply", "DB", ...args]);
const sql = `INSERT INTO bootstrap(id,token_hash,expires_at) VALUES(1,'${createHash("sha256").update(token).digest("hex")}',${Date.now() + 1800000});\nINSERT INTO members(user_id,email,role,status,created_at) VALUES('${created.data.user.id}','${users.member.email}','member','active',${Date.now()});`;
await writeFile(".local/e2e-fixtures.sql", sql);
await runTool("wrangler", [
  "d1",
  "execute",
  "DB",
  ...args,
  "--file",
  ".local/e2e-fixtures.sql",
]);
await runTool("vite", [], { env: { CLOUDFLARE_ENV: "e2e" } });
