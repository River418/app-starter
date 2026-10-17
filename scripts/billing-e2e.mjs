import { readFile, writeFile, open, unlink, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
await mkdir(".local", { recursive: true });
const lock = await open(".local/billing-e2e.lock", "wx"),
  path = "app.config.ts",
  original = await readFile(path, "utf8");
try {
  if (/billing\s*:/.test(original))
    throw new Error(
      "Billing E2E runner expects the default disabled billing config; preserve custom config and run in a clean checkout.",
    );
  await writeFile(
    path,
    original.replace(
      "maxFileBytes:",
      "billing: {enabled:true,currency:'usd',creditPack:{amountMinor:490,credits:50,features:['export']}},\n  maxFileBytes:",
    ),
  );
  process.exitCode = await new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", "billing"],
      {
        stdio: "inherit",
        env: { ...process.env, APP_STARTER_BILLING_E2E: "1" },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => accept(code || 0));
  });
} finally {
  await writeFile(path, original);
  await lock.close();
  await unlink(".local/billing-e2e.lock");
}
