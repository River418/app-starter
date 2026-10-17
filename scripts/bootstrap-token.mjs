import { randomBytes, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { runTool } from "./process.mjs";
import { readWranglerConfig } from "./config.mjs";
const environment = process.argv[2] || "local";
if (!["local", "dev", "prod"].includes(environment))
  throw new Error("Use local, dev or prod");
const config = await readWranglerConfig();
const target = environment === "local" ? config : config.env[environment];
const args =
  environment === "local" ? ["--local"] : ["--remote", "--env", environment];
const cliEnv = target.account_id
  ? { CLOUDFLARE_ACCOUNT_ID: target.account_id }
  : {};
const rows = JSON.parse(
  await runTool(
    "wrangler",
    [
      "d1",
      "execute",
      "DB",
      ...args,
      "--command",
      "SELECT state,expires_at FROM bootstrap WHERE id=1",
      "--json",
    ],
    { capture: true, env: cliEnv },
  ),
)[0].results;
if (rows[0] && (rows[0].state !== "ready" || rows[0].expires_at > Date.now()))
  throw new Error(
    "Bootstrap already issued/claimed/complete. Use the existing private link; never reset an initialized app.",
  );
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
await mkdir(".local", { recursive: true });
const sqlFile = `.local/bootstrap-${environment}.sql`;
await writeFile(
  sqlFile,
  `INSERT INTO bootstrap(id,token_hash,expires_at) SELECT 1,'${hash}',${Date.now() + 1800000} WHERE NOT EXISTS(SELECT 1 FROM members WHERE role='admin') ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at WHERE bootstrap.state='ready' AND bootstrap.expires_at<${Date.now()};`,
);
await runTool("wrangler", ["d1", "execute", "DB", ...args, "--file", sqlFile], {
  capture: true,
  env: cliEnv,
});
const output = `.local/bootstrap-${environment}.txt`;
await writeFile(
  output,
  `${target.vars.APP_ORIGIN}/bootstrap?token=${token}\n`,
  { mode: 0o600 },
);
console.log(
  `One-time administrator link saved privately to ${output} (expires in 30 minutes).`,
);
