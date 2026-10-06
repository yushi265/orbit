import handler from "@tanstack/react-start/server-entry";
import type { RuntimeEnvironment } from "./server/auth";
import { runScheduledCycles } from "./server/scheduled-cycles";

// createServerEntryはfetch以外を落とすため使わず、素のオブジェクトでscheduledを併設する。
export default {
  fetch: handler.fetch,
  async scheduled(_controller: ScheduledController, env: RuntimeEnvironment): Promise<void> {
    await runScheduledCycles(env);
  },
};
