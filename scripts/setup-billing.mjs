import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import config from "../app.config.ts";
import { normalizeBilling } from "../src/shared/billing-config.ts";
import { readWranglerConfig } from "./config.mjs";
import { runTool } from "./process.mjs";
import {
  syncCatalog,
  digest,
  apiVersion,
  eventTypes,
  resolveSigningSecret,
} from "./billing-catalog.mjs";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function localSecrets(environment) {
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
  return {
    ...values,
    ...Object.fromEntries(
      ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    ),
  };
}
export async function setupBilling(environment) {
  if (!["dev", "prod"].includes(environment))
    throw new Error("Usage: npm run billing:setup -- dev|prod");
  const billing = normalizeBilling(config.billing);
  if (!billing.enabled) return;
  const wrangler = await readWranglerConfig("wrangler.jsonc"),
    target = wrangler.env[environment],
    origin = target.vars.APP_ORIGIN;
  if (
    !origin.startsWith("https://") ||
    !target.account_id ||
    !target.d1_databases[0]?.database_id
  )
    throw new Error(
      "Configure and deploy target resources before billing setup",
    );
  const secrets = await localSecrets(environment);
  if (!secrets.STRIPE_SECRET_KEY)
    throw new Error(
      `Set your own STRIPE_SECRET_KEY in ignored .dev.vars.${environment}`,
    );
  const stripe = new Stripe(secrets.STRIPE_SECRET_KEY, {
    apiVersion,
    maxNetworkRetries: 2,
  });
  const dir = `.local/billing/${environment}`;
  await mkdir(dir, { recursive: true });
  const cliEnv = { CLOUDFLARE_ACCOUNT_ID: target.account_id };
  const cli = ["--env", environment, "--remote"];
  async function execute(sql, read = false) {
    await writeFile(`${dir}/query.sql`, sql);
    const output = await runTool(
      "wrangler",
      [
        "d1",
        "execute",
        "DB",
        ...cli,
        // Remote --file uses D1's bulk import API and returns import progress,
        // not SELECT rows. Read mappings through the native query API instead.
        ...(read ? ["--command", sql] : ["--file", `${dir}/query.sql`]),
        ...(read ? ["--json"] : []),
      ],
      { capture: true, env: cliEnv },
    );
    return read ? JSON.parse(output)[0].results : undefined;
  }
  const previous = (
    await execute("SELECT * FROM billing_state WHERE id=1;", true)
  )[0];
  const save = async (state, prices) => {
    const s = { ...state, key_hash: digest(secrets.STRIPE_SECRET_KEY) };
    const statements = [
      `INSERT INTO billing_state(id,${Object.keys(s).join(",")}) VALUES(1,${Object.values(s).map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET ${Object.keys(
        s,
      )
        .map((k) => `${k}=excluded.${k}`)
        .join(",")};`,
      ...prices.map(
        (p) =>
          `INSERT OR IGNORE INTO billing_prices(${Object.keys(p).join(",")}) VALUES(${Object.values(p).map(quote).join(",")});`,
      ),
    ];
    await execute(statements.join("\n"));
  };
  save.origin = origin;
  const { state, prices } = await syncCatalog(stripe, {
    slug: config.slug,
    environment,
    billing,
    previous,
    save,
  });
  let privateState = {};
  try {
    privateState = JSON.parse(await readFile(`${dir}/private.json`, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (privateState.namespace && privateState.namespace !== state.namespace)
    throw new Error("Private Stripe setup state belongs to another account");
  privateState.namespace = state.namespace;
  const url = `${origin}/api/billing/webhook`;
  let endpoint;
  if (state.endpoint_id)
    endpoint = await stripe.webhookEndpoints.retrieve(state.endpoint_id);
  else if (privateState.endpointId)
    endpoint = await stripe.webhookEndpoints.retrieve(privateState.endpointId);
  else {
    if (!privateState.endpointOperation) {
      for await (const existing of stripe.webhookEndpoints.list({ limit: 100 }))
        if (existing.metadata?.namespace === state.namespace)
          throw new Error(
            "Owned endpoint already exists but its creation journal is missing; restore endpointId and its signing secret, do not create a duplicate",
          );
    }
    // Persist exact request before the response-only signing secret can be lost.
    if (!privateState.endpointOperation) {
      privateState.endpointOperation = {
        key: `webhook:${state.namespace}:${crypto.randomUUID()}`,
        createdAt: Date.now(),
        params: {
          url,
          api_version: apiVersion,
          enabled_events: eventTypes,
          metadata: { namespace: state.namespace },
        },
      };
      await writeFile(`${dir}/private.json`, JSON.stringify(privateState), {
        mode: 0o600,
      });
    }
    const op = privateState.endpointOperation;
    if (Date.now() - op.createdAt > 23 * 3600000)
      throw new Error(
        "Webhook creation response expired. Restore its endpoint ID and signing secret from Stripe Dashboard into the private setup file; do not recreate automatically.",
      );
    endpoint = await stripe.webhookEndpoints.create(op.params, {
      idempotencyKey: op.key,
    });
    privateState.endpointId = endpoint.id;
    privateState.webhookSecret = endpoint.secret;
    await writeFile(`${dir}/private.json`, JSON.stringify(privateState), {
      mode: 0o600,
    });
  }
  if (
    endpoint.metadata?.namespace !== state.namespace ||
    endpoint.url !== url ||
    endpoint.api_version !== apiVersion ||
    endpoint.livemode !== Boolean(state.livemode) ||
    endpoint.application
  )
    throw new Error(
      "Webhook endpoint ownership, environment or API version mismatch",
    );
  await stripe.webhookEndpoints.update(endpoint.id, {
    enabled_events: eventTypes,
    disabled: false,
  });
  const webhookSecret = resolveSigningSecret({
    provided: secrets.STRIPE_WEBHOOK_SECRET,
    created: endpoint.secret,
    backup: privateState.webhookSecret,
    expectedHash: previous?.secret_hash || undefined,
  });
  if (!webhookSecret)
    throw new Error(
      `Signing secret cannot be retrieved by API. Restore STRIPE_WEBHOOK_SECRET in .dev.vars.${environment} from Stripe Dashboard and rerun setup.`,
    );
  state.endpoint_id = endpoint.id;
  state.secret_hash = digest(webhookSecret);
  await save(state, prices);
  const secretFile = `${dir}/publish.json`;
  await writeFile(
    secretFile,
    JSON.stringify({
      STRIPE_SECRET_KEY: secrets.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    }),
    { mode: 0o600 },
  );
  await runTool(
    "wrangler",
    ["secret", "bulk", secretFile, "--env", environment],
    { capture: true, env: cliEnv },
  );
  const nonce = crypto.randomUUID(),
    payload = JSON.stringify({
      id: `setup_${nonce}`,
      type: "app_starter.setup_probe",
      livemode: !!state.livemode,
      data: { object: { namespace: state.namespace, nonce } },
    });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  let accepted = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
    if (response.ok && (await response.json()).nonce === nonce) {
      accepted = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!accepted)
    throw new Error(
      "Active Worker did not verify the signing-secret probe. Billing remains closed.",
    );
  await execute(
    `UPDATE billing_state SET ready=1 WHERE id=1 AND namespace=${quote(state.namespace)} AND config_hash=${quote(state.config_hash)} AND secret_hash=${quote(state.secret_hash)};`,
  );
  const catalog = await fetch(`${origin}/api/billing/catalog`);
  if (!catalog.ok || !(await catalog.json()).ready)
    throw new Error("Billing readiness verification failed");
  console.log(
    `Billing ready for ${environment}; no purchase or live charge was made. Signing probe is not a Stripe Sandbox end-to-end test.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  setupBilling(process.argv[2]).catch(() => {
    console.error(
      "Billing setup failed. No readiness was granted. Check account/mode, local credentials, private setup backup, deployed Worker and D1 mappings. See docs/billing.md. Provider payloads were withheld.",
    );
    process.exitCode = 1;
  });
