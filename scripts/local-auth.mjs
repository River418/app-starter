import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import config from "../app.config.ts";
const action = process.argv[2];
if (!["start", "stop"].includes(action))
  throw new Error("Usage: local-auth.mjs start|stop");
const executable = process.env.SUPABASE_CLI || "supabase";
await mkdir(".local", { recursive: true });
async function cli(args) {
  return new Promise((accept, reject) => {
    let output = "";
    let error = "";
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (v) => (output += v));
    child.stderr.on("data", (v) => (error += v));
    child.on("error", reject);
    child.on("exit", async (code) => {
      await writeFile(".local/supabase-cli.log", output + error);
      code === 0
        ? accept(output)
        : reject(
            new Error(
              "Supabase CLI failed; inspect ignored .local/supabase-cli.log",
            ),
          );
    });
  });
}
if (action === "stop") {
  await cli(["stop", "--project-id", "app-starter-e2e"]);
  console.log("Stopped isolated local Auth; local data backup retained.");
  process.exit(0);
}
const configPath = "supabase/config.toml";
const toml = await readFile(configPath, "utf8");
if (!toml.includes('project_id = "app-starter-e2e"'))
  throw new Error("Refuse to manage another local Auth project");
const desired = config.authMode === "public";
const next = toml.replace(
  /(\[auth\][\s\S]*?enable_signup\s*=\s*)(true|false)/,
  `$1${desired}`,
);
const running = await fetch("http://localhost:55321/auth/v1/settings")
  .then((r) => r.status !== 503)
  .catch(() => false);
if (next !== toml) {
  await writeFile(configPath, next);
  if (running) await cli(["stop", "--project-id", "app-starter-e2e"]);
}
await cli([
  "start",
  "--exclude",
  "realtime,storage-api,imgproxy,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
]);
const status = JSON.parse(await cli(["status", "--output", "json"]));
const settings = await fetch(`${status.API_URL}/auth/v1/settings`, {
  headers: { apikey: status.PUBLISHABLE_KEY || status.ANON_KEY },
}).then((r) => r.json());
if (
  settings.disable_signup !== !desired ||
  settings.mailer_autoconfirm !== false
)
  throw new Error(
    "Local Auth settings mismatch; stop and restart the isolated Auth stack",
  );
await writeFile(".local/supabase-status.json", JSON.stringify(status), {
  mode: 0o600,
});
let exists = true;
try {
  await access(".dev.vars");
} catch {
  exists = false;
}
if (!exists)
  await writeFile(
    ".dev.vars",
    `SUPABASE_URL="http://localhost:55321"\nSUPABASE_PUBLISHABLE_KEY="${status.PUBLISHABLE_KEY || status.ANON_KEY}"\nSUPABASE_SECRET_KEY="${status.SECRET_KEY || status.SERVICE_ROLE_KEY}"\n`,
    { mode: 0o600 },
  );
console.log(
  "Local Auth ready at http://localhost:55321; Mailpit http://localhost:55324. Existing .dev.vars was preserved.",
);
