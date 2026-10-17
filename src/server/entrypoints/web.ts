import { app } from "../app";
import { maintainFiles } from "../maintenance";
import type { Bindings } from "../types";
import { maintainBilling } from "../../features/billing/server/reconcile";
export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      Promise.all([maintainFiles(env, 10), maintainBilling(env, 10)]),
    );
  },
};
