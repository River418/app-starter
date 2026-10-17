// Opt-in manual acceptance: real Stripe hosted UI + real provider events -> CLI -> local Worker.
import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import Stripe from "stripe";
import { apiVersion, eventTypes } from "./billing-catalog.mjs";
const dir = ".local/billing/sandbox-browser";
if (process.env.APP_STARTER_BILLING_E2E || process.env.STRIPE_TEST_API_URL)
  throw new Error("Real Sandbox acceptance cannot use a provider substitute");
await mkdir(dir, { recursive: true });
if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_SANDBOX_ACCOUNT_ID)
  throw new Error("Load your dedicated managed Sandbox environment");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion,
    timeout: 15000,
    maxNetworkRetries: 1,
  }),
  account = await stripe.accounts.retrieveCurrent(),
  balance = await stripe.balance.retrieve();
if (account.id !== process.env.STRIPE_SANDBOX_ACCOUNT_ID || balance.livemode)
  throw new Error("Dedicated test account admission failed");
// Refuse an existing server before resetting the isolated E2E database or starting callbacks.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(new Error("Stop the existing localhost:5173 server first")),
  );
  probe.listen(5173, "localhost", () => probe.close(resolve));
});
const configPath = "app.config.ts",
  original = await readFile(configPath, "utf8");
if (/billing\s*:/.test(original))
  throw new Error(
    "Manual acceptance expects the default billing-disabled config in an isolated checkout",
  );
const lock = await open(`${dir}/browser.lock`, "wx");
const children = [];
const controller = new AbortController();
let failure;
const stop = (reason) => {
  if (reason instanceof Error) failure ??= reason;
  controller.abort();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const check = () => controller.signal.throwIfAborted();
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
let listenLog;
const envPath = ".dev.vars.e2e";
let previousEnv;
try {
  check();
  previousEnv = await readFile(envPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  listenLog = await open(`${dir}/listener.private.log`, "w", 0o600);
  await listenLog.chmod(0o600);
  await writeFile(`${dir}/app-config.original.private.txt`, original);
  await writeFile(
    configPath,
    original.replace(
      "maxFileBytes:",
      "billing: {enabled:true,currency:'usd',monthly:{amountMinor:990,credits:100,features:['export']},creditPack:{amountMinor:490,credits:50,features:['export']}},\n  maxFileBytes:",
    ),
  );
  check();
  const listener = spawn(
    process.env.STRIPE_CLI || "stripe",
    [
      "listen",
      "--latest",
      "--events",
      eventTypes.join(","),
      "--forward-to",
      "http://localhost:5173/api/billing/webhook",
    ],
    {
      detached: process.platform !== "win32",
      // npm's Windows CLI shim needs cmd; an explicit native executable path avoids the shell.
      shell: process.platform === "win32" && !process.env.STRIPE_CLI,
      windowsHide: true,
      env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(listener);
  listener.once("exit", () => {
    if (!controller.signal.aborted)
      stop(new Error("Stripe listener exited unexpectedly"));
  });
  let log = "";
  const capture = (chunk) => {
    log = (log + chunk).slice(-16384);
    void listenLog.write(chunk);
  };
  listener.stdout.on("data", capture);
  listener.stderr.on("data", capture);
  listener.on("error", () => {
    stop(new Error("Stripe listener failed; check STRIPE_CLI or your PATH"));
  });
  let secret;
  for (let attempt = 0; attempt < 60; attempt++) {
    check();
    secret = log.match(/whsec_[a-zA-Z0-9_]+/)?.[0];
    if (secret) break;
    if (listener.exitCode !== null)
      throw new Error("Stripe listener exited before readiness");
    await pause();
  }
  if (!secret)
    throw new Error(
      "Stripe listener did not become ready; private log withheld",
    );
  check();
  const server = spawn(process.execPath, ["scripts/e2e-server.mjs"], {
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      APP_STARTER_REAL_STRIPE_E2E: "1",
      STRIPE_WEBHOOK_SECRET: secret,
    },
  });
  children.push(server);
  server.once("exit", () => {
    if (!controller.signal.aborted)
      stop(new Error("Local application exited unexpectedly"));
  });
  server.once("error", () =>
    stop(new Error("Local application failed to start")),
  );
  for (let attempt = 0; attempt < 180; attempt++) {
    check();
    const response = await fetch("http://localhost:5173/api/billing/catalog", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
    }).catch(() => null);
    check();
    if (response?.ok && (await response.json()).ready) {
      console.log(
        JSON.stringify({
          ready: true,
          accountId: account.id,
          origin: "http://localhost:5173",
          provider: "real_stripe",
          callback: "Stripe -> CLI -> local Worker",
        }),
      );
      break;
    }
    if (server.exitCode !== null) throw new Error("Local application exited");
    await pause();
    if (attempt === 179) throw new Error("Application readiness timeout");
  }
  if (!controller.signal.aborted)
    await new Promise((resolve) =>
      controller.signal.addEventListener("abort", resolve, { once: true }),
    );
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally {
  for (const child of children) {
    if (
      child.pid &&
      (process.platform !== "win32" || child.exitCode === null)
    ) {
      if (process.platform === "win32")
        await new Promise((resolve) => {
          const killer = spawn(
            "taskkill",
            ["/pid", String(child.pid), "/t", "/f"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.once("exit", resolve);
          killer.once("error", resolve);
        });
      else {
        // The wrapper spawns Vite/Worker descendants; terminate only this owned process group.
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
  }
  await writeFile(configPath, original);
  if (previousEnv !== undefined && previousEnv !== null) {
    const restored = await open(envPath, "w", 0o600);
    try {
      await restored.chmod(0o600);
      await restored.writeFile(previousEnv);
    } finally {
      await restored.close();
    }
  } else if (previousEnv === null)
    await unlink(envPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  await listenLog?.close();
  await lock.close();
  await unlink(`${dir}/browser.lock`);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
if (failure) throw failure;
