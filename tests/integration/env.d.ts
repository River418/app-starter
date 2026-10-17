import type { Bindings } from "../../src/server/types";
declare module "cloudflare:workers" {
  interface Env extends Bindings {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
