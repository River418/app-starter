export function validateDeployment(config, environment, target) {
  if (
    !["dev", "prod"].includes(environment) ||
    target?.vars?.APP_ENV !== environment
  )
    throw new Error("Deployment environment mismatch");
  if (
    !/^[a-z0-9][a-z0-9-]{1,45}$/.test(config.slug) ||
    !["web", "agent"].includes(config.preset)
  )
    throw new Error("Invalid app configuration");
  if (!/^[a-f0-9]{32}$/.test(target.account_id || ""))
    throw new Error("Configure target account_id");
  const vars = target.vars;
  if (
    !vars.APP_ORIGIN?.startsWith("https://") ||
    new URL(vars.APP_ORIGIN).origin !== vars.APP_ORIGIN
  )
    throw new Error("Configure HTTPS APP_ORIGIN without a path");
  if (
    !vars.SUPABASE_URL?.startsWith("https://") ||
    !vars.SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error("Configure Supabase auth");
  if (vars.AUTH_SETTINGS_CONFIRMED !== config.authMode)
    throw new Error(
      "Confirm Supabase auth settings for selected mode (including SMTP in public mode)",
    );
  if (target.d1_databases.length !== 1 || target.r2_buckets.length !== 1)
    throw new Error("Prepare one D1 and one private R2 resource");
  if (!target.d1_databases[0].database_id || !target.r2_buckets[0].bucket_name)
    throw new Error("Missing resource mapping");
}
export async function assertPresetTransition({
  previous,
  next,
  acceptingRuns,
  readState,
}) {
  if (previous !== "agent" || next !== "web") return;
  if (acceptingRuns)
    throw new Error("Stop accepting runs before changing preset");
  const state = await readState();
  if (["activeRuns", "outbox", "unsettled"].some((key) => state[key] !== 0))
    throw new Error(
      "Drain agent runs, outbox and reservations before deployment",
    );
}
export function bucketNames(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^name:\s+(.+?)\s*$/.exec(line);
    return match ? [match[1]] : [];
  });
}
export async function assertRemotePreset(origin, next, fetcher = fetch) {
  const response = await fetcher(`${origin}/api/config`, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return;
  if (!response.ok)
    throw new Error(
      "Cannot read current deployment; refusing an unsafe preset change",
    );
  const current = await response.json();
  if (!["web", "agent"].includes(current.preset))
    throw new Error("Unrecognized deployed preset");
  if (current.preset === "agent" && next === "web")
    throw new Error("Agent to web requires the Phase 4 live drain gate");
}
export async function assertAuthSettings(config, target, fetcher = fetch) {
  const response = await fetcher(
    `${target.vars.SUPABASE_URL}/auth/v1/settings`,
    {
      headers: { apikey: target.vars.SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("Unable to verify Supabase auth settings");
  const settings = await response.json();
  if (
    settings.disable_signup !== (config.authMode === "invite") ||
    settings.mailer_autoconfirm !== false ||
    settings.external?.email !== true ||
    settings.external?.anonymous_users !== false
  )
    throw new Error(
      "Supabase auth settings mismatch: require email verification, disable anonymous users and match signup mode",
    );
}
