import { defineConfig } from "vite";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import config from "./app.config";
import { checkBoundaries } from "./scripts/boundaries.mjs";

export default defineConfig({
  plugins: [
    {
      name: "source-boundaries",
      buildStart() {
        checkBoundaries(process.cwd());
      },
    },
    react(),
    tailwindcss(),
    cloudflare({
      configPath: process.env.APP_STARTER_WRANGLER_CONFIG || "wrangler.jsonc",
      viteEnvironment: { name: "worker" },
      config: { main: resolve(`src/server/entrypoints/${config.preset}.ts`) },
      remoteBindings: false,
      persistState:
        process.env.CLOUDFLARE_ENV === "e2e"
          ? { path: ".local/e2e-workers" }
          : true,
    }),
    {
      name: "client-module-evidence",
      applyToEnvironment: (e) => e.name === "client",
      generateBundle() {
        mkdirSync(".local", { recursive: true });
        writeFileSync(
          ".local/client-modules.json",
          JSON.stringify(
            [...this.getModuleIds()]
              .filter((id) => !id.startsWith("\0"))
              .map((id) =>
                id
                  .replaceAll("\\", "/")
                  .replace(process.cwd().replaceAll("\\", "/"), "."),
              ),
          ),
        );
      },
    },
  ],
  server: { host: "localhost", port: 5173, strictPort: true },
  environments: { worker: { build: { sourcemap: true } } },
});
