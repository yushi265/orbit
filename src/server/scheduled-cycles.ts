import { createDb } from "../db/client";
import { findOwnedUser } from "../db/repositories/owner";
import type { RuntimeEnvironment } from "./auth";
import { ServiceError } from "./errors";
import { LOCAL_OWNER, resolveRuntimeConfig } from "./runtime-config";
import { openStoreSession } from "./store-session";

const MAX_ATTEMPTS = 3;

export type ScheduledCyclesResult =
  | { outcome: "skipped"; reason: "memory_storage" | "run_in_progress" }
  | {
      outcome: "completed";
      processed: number;
      hasRemaining: boolean;
      persisted: boolean;
      attempts: number;
    };

async function resolveOwner(
  env: RuntimeEnvironment,
  mode: "local" | "production" | "development",
): Promise<{ userId: string; email: string }> {
  let owner: { userId: string; email: string };
  if (mode === "local") owner = { userId: LOCAL_OWNER.userId, email: LOCAL_OWNER.email };
  else {
    if (!env.OWNER_USER_ID || !env.OWNER_EMAIL) throw new Error("Owner is not configured");
    owner = { userId: env.OWNER_USER_ID, email: env.OWNER_EMAIL };
  }
  if (!env.DB) throw new Error("D1 binding is missing");
  const row = await findOwnedUser(createDb({ DB: env.DB }), owner.userId, owner.email);
  if (!row) throw new Error("Owner was not found");
  return owner;
}

async function run(env: RuntimeEnvironment): Promise<ScheduledCyclesResult> {
  const config = resolveRuntimeConfig(env);
  if (config.storage === "memory") return { outcome: "skipped", reason: "memory_storage" };
  const { userId, email } = await resolveOwner(env, config.mode);

  for (let attempts = 1; ; attempts += 1) {
    const session = await openStoreSession(userId, email, env);
    const result = session.store.runScheduledCycleTransitions(userId);
    if (result.status === "locked") return { outcome: "skipped", reason: "run_in_progress" };
    const shouldPersist = result.processed > 0 || session.needsInitialPersist;
    try {
      if (shouldPersist) await session.persist();
    } catch (error) {
      const retryable =
        error instanceof ServiceError &&
        error.code === "D1_WRITE_CONFLICT" &&
        attempts < MAX_ATTEMPTS;
      if (retryable) continue;
      throw error;
    }
    return {
      outcome: "completed",
      processed: result.processed,
      hasRemaining: result.hasRemaining,
      persisted: shouldPersist,
      attempts,
    };
  }
}

export async function runScheduledCycles(env: RuntimeEnvironment): Promise<ScheduledCyclesResult> {
  try {
    const result = await run(env);
    console.log(JSON.stringify({ event: "scheduled_cycles", ...result }));
    return result;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "scheduled_cycles",
        outcome: "failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw error;
  }
}
