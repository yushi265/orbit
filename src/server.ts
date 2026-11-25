import handler from "@tanstack/react-start/server-entry";
import { runDailyDigest, type DailyDigestEnv } from "./server/daily-digest";

type ScheduledContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: (...args: Parameters<typeof handler.fetch>) => handler.fetch(...args),
  scheduled(controller: { scheduledTime: number }, env: DailyDigestEnv, ctx: ScheduledContext) {
    ctx.waitUntil(runDailyDigest(env, controller.scheduledTime));
  },
};
