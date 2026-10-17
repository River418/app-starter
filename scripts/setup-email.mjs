import { readFile, writeFile, mkdir } from "node:fs/promises";
import config from "../app.config.ts";
import { readWranglerConfig } from "./config.mjs";
import { setupEmail } from "./email-setup.mjs";
import { normalizeEmail, mailbox } from "../src/shared/email-config.ts";
const environment = process.argv[2];
if (!["dev", "prod"].includes(environment))
  throw new Error("Usage: npm run email:setup -- dev|prod");
const email = normalizeEmail(config.email);
if (!email.sending && !email.forwarding) {
  console.log("Optional email is disabled.");
  process.exit(0);
}
async function execute() {
  let values = {};
  try {
    for (const line of (
      await readFile(`.dev.vars.${environment}`, "utf8")
    ).split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
      if (match) {
        let v = match[2].trim();
        if (v.startsWith('"')) v = JSON.parse(v);
        else if (v.startsWith("'")) v = v.slice(1, -1);
        values[match[1]] = v;
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const secret = (name) => process.env[name] || values[name];
  const target = (await readWranglerConfig("wrangler.jsonc")).env[environment],
    accountId = target.account_id;
  if (
    !accountId ||
    !secret("CLOUDFLARE_API_TOKEN") ||
    (email.sending && !secret("RESEND_SETUP_API_KEY"))
  )
    throw new Error(
      "Configure selected account and private email setup credentials",
    );
  const api =
    (base, token, cloudflare = false) =>
    async (path, method = "GET", body) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Email provider API rejected setup");
      const result = await response.json();
      if (cloudflare && !result.success)
        throw new Error("Cloudflare rejected email setup");
      return cloudflare ? result.result : result;
    };
  const status = await setupEmail({
    cf: api(
      "https://api.cloudflare.com/client/v4",
      secret("CLOUDFLARE_API_TOKEN"),
      true,
    ),
    resend: api("https://api.resend.com", secret("RESEND_SETUP_API_KEY")),
    accountId,
    email,
    forwardTo: secret("EMAIL_FORWARD_TO"),
    slug: config.slug,
    environment,
  });
  const dir = `.local/email/${environment}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/status.json`, JSON.stringify(status, null, 2), {
    mode: 0o600,
  });
  if (email.sending && secret("RESEND_API_KEY")) {
    await writeFile(
      `${dir}/supabase-smtp.private.json`,
      JSON.stringify(
        {
          smtp_host: "smtp.resend.com",
          smtp_port: 465,
          smtp_user: "resend",
          smtp_pass: secret("RESEND_API_KEY"),
          smtp_admin_email: mailbox(email.sending.from),
          smtp_sender_name: config.title,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  console.log(JSON.stringify(status));
  console.log(
    "Review destination verification/DNS status. Configure Supabase custom SMTP from the private local file; publish only RESEND_API_KEY to the Worker. See docs/email.md.",
  );
}
execute().catch(() => {
  console.error(
    "Email setup failed. Existing DNS/rules were preserved on conflict. Check token permissions, domain ownership and ignored configuration; see docs/email.md. Private provider details were withheld.",
  );
  process.exitCode = 1;
});
