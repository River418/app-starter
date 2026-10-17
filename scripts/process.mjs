import { spawn } from "node:child_process";
import { resolve } from "node:path";
export function runTool(name, args, { capture = false, env = {} } = {}) {
  const paths = {
    vite: "vite/bin/vite.js",
    wrangler: "wrangler/bin/wrangler.js",
    tsc: "typescript/bin/tsc",
  };
  return new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [resolve("node_modules", paths[name]), ...args],
      {
        env: { ...process.env, ...env },
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      },
    );
    let output = "";
    if (capture)
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept(output) : reject(new Error(`${name} exited ${code}`)),
    );
  });
}
