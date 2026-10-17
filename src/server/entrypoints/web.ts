import { app } from "../app";
import { maintainFiles } from "../maintenance";
import type { Bindings } from "../types";
export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(maintainFiles(env));
  },
};
