import { runTool } from "./process.mjs";
await runTool("wrangler", ["d1", "migrations", "apply", "DB", "--local"]);
await runTool("vite", []);
