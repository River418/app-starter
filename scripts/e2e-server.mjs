import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runTool } from "./process.mjs";
import config from "../app.config.ts";
import { normalizeBilling } from "../src/shared/billing-config.ts";
import { digest } from "./billing-catalog.mjs";
import { startStripeSubstitute } from "../tests/support/stripe-server.mjs";
import Stripe from "stripe";
import { syncCatalog, apiVersion } from "./billing-catalog.mjs";
const root = process.cwd();
if (
  process.env.APP_STARTER_REAL_STRIPE_E2E &&
  (process.env.APP_STARTER_BILLING_E2E || process.env.STRIPE_TEST_API_URL)
)
  throw new Error("Choose a real provider or a substitute, never both");
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
  { mode: 0o600 },
);
await chmod(".dev.vars.e2e", 0o600);
if (process.env.APP_STARTER_BILLING_E2E) {
  await startStripeSubstitute();
  const vars = await readFile(".dev.vars.e2e", "utf8");
  await writeFile(
    ".dev.vars.e2e",
    vars +
      'STRIPE_SECRET_KEY="sk_test_local_browser_fixture"\nSTRIPE_WEBHOOK_SECRET="whsec_local_browser_fixture"\nSTRIPE_TEST_API_URL="http://127.0.0.1:55431"\n',
  );
}
if (process.env.APP_STARTER_REAL_STRIPE_E2E) {
  const key = process.env.STRIPE_SECRET_KEY,
    secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret || !process.env.STRIPE_SANDBOX_ACCOUNT_ID)
    throw new Error(
      "Dedicated Sandbox key, account and listener secret required",
    );
  const stripe = new Stripe(key, { apiVersion }),
    account = await stripe.accounts.retrieveCurrent(),
    balance = await stripe.balance.retrieve();
  if (balance.livemode || account.id !== process.env.STRIPE_SANDBOX_ACCOUNT_ID)
    throw new Error("Refuse a live or different Stripe account");
  const vars = await readFile(".dev.vars.e2e", "utf8");
  await writeFile(
    ".dev.vars.e2e",
    vars +
      `STRIPE_SECRET_KEY=${JSON.stringify(key)}\nSTRIPE_WEBHOOK_SECRET=${JSON.stringify(secret)}\n`,
    { mode: 0o600 },
  );
}
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
if (process.env.APP_STARTER_BILLING_E2E) {
  const b = normalizeBilling(config.billing),
    p = b.plans[0];
  const namespace = digest(`${config.slug}:e2e:acct_e2e:false`).slice(0, 32);
  const sql = `INSERT INTO billing_state VALUES(1,'${namespace}','acct_e2e',0,'${digest(b)}','${digest("sk_test_local_browser_fixture")}','http://localhost:5173','bpc_e2e','we_e2e','${digest("whsec_local_browser_fixture")}',1);\nINSERT INTO billing_prices VALUES('price_e2e_creditPack','${namespace}','creditPack','${digest({ ...p, currency: b.currency, taxBehavior: b.taxBehavior })}','usd',490,50,'["export"]','exclusive');`;
  await writeFile(".local/e2e-billing.sql", sql);
  await runTool("wrangler", [
    "d1",
    "execute",
    "DB",
    ...args,
    "--file",
    ".local/e2e-billing.sql",
  ]);
}
if (process.env.APP_STARTER_REAL_STRIPE_E2E) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion });
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const save = async (state, prices) => {
    const current = {
      ...state,
      key_hash: digest(process.env.STRIPE_SECRET_KEY),
      secret_hash: digest(process.env.STRIPE_WEBHOOK_SECRET),
      endpoint_id: "stripe_cli_listener",
      ready: 1,
    };
    const sql = [
      `INSERT INTO billing_state(id,${Object.keys(current).join(",")}) VALUES(1,${Object.values(current).map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET ${Object.keys(
        current,
      )
        .map((k) => `${k}=excluded.${k}`)
        .join(",")};`,
      ...prices.map(
        (p) =>
          `INSERT OR IGNORE INTO billing_prices(${Object.keys(p).join(",")}) VALUES(${Object.values(p).map(quote).join(",")});`,
      ),
    ];
    await writeFile(".local/e2e-real-stripe.sql", sql.join("\n"));
    await runTool("wrangler", [
      "d1",
      "execute",
      "DB",
      ...args,
      "--file",
      ".local/e2e-real-stripe.sql",
    ]);
  };
  save.origin = "http://localhost:5173";
  await syncCatalog(stripe, {
    slug: config.slug,
    environment: "e2e",
    billing: normalizeBilling(config.billing),
    save,
  });
}
await runTool("vite", [], { env: { CLOUDFLARE_ENV: "e2e" } });
