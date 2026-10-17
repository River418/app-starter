import { readFile, writeFile, open, unlink, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
await mkdir(".local", { recursive: true });
const path = "app.config.ts";
const cli = async (action) =>
  new Promise((accept, reject) => {
    const child = spawn(process.execPath, ["scripts/local-auth.mjs", action], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error("Local Auth mode switch failed")),
    );
  });
const original = await readFile(path, "utf8");
if (!/authMode:\s*['"]invite['"]/.test(original))
  throw new Error("Public E2E expects a clean invite-mode config");
const lock = await open(".local/public-e2e.lock", "wx");
try {
  await writeFile(
    path,
    original.replace(/authMode:\s*['"]invite['"]/, 'authMode: "public"'),
  );
  await cli("start");
  const code = await new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", "public-auth"],
      {
        stdio: "inherit",
        env: { ...process.env, APP_STARTER_PUBLIC_E2E: "1" },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => accept(code ?? 1));
  });
  process.exitCode = code || 0;
} finally {
  try {
    await writeFile(path, original);
    await cli("start");
  } finally {
    await lock.close();
    await unlink(".local/public-e2e.lock");
  }
}
