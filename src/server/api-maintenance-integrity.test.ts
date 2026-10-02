import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { continueBackgroundRun, getBackgroundRun } from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";

const OWNER = "api-maintenance-owner";

function continueRequest(runId: string, cursor: string | null = null) {
  return new Request(`https://orbit.example/api/v1/background-runs/${runId}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ idempotencyKey: "continue-api", expected_cursor: cursor }),
  });
}

describe("Maintenance API integrity", () => {
  beforeEach(() => {
    resetOrbitStores();
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ORBIT_STORAGE", "memory");
    vi.stubEnv("DEV_OWNER_USER_ID", OWNER);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    resetOrbitStores();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("[状態遷移] 完了RunへのContinue再送は200・next noneで業務効果を増やさない", async () => {
    const store = getOrbitStore(OWNER);
    const run = store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "terminal-run" });
    let cursor: string | null = null;
    for (let index = 0; index < 3; index += 1)
      cursor = store.continueRun(OWNER, run.run_id, {
        idempotencyKey: `complete-${index}`,
        expected_cursor: cursor,
      }).cursor;
    expect(run.status).toBe("succeeded");
    const before = store.toSnapshot();

    const response = await continueBackgroundRun(continueRequest(run.run_id), run.run_id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run: { run_id: run.run_id, status: "succeeded" },
      next: "none",
      step: null,
      cursor: null,
      processed_count: 0,
    });
    expect(store.toSnapshot()).toEqual(before);
  });

  it.each(["paused", "failed"] as const)(
    "[状態遷移] %s RunへのContinueは409 RUN_REQUIRES_RESUMEを返す",
    async (status) => {
      const store = getOrbitStore(OWNER);
      const run = store.startRun(OWNER, {
        kind: "maintenance",
        idempotencyKey: `resume-${status}`,
      });
      run.status = status;
      const before = store.toSnapshot();

      const response = await continueBackgroundRun(continueRequest(run.run_id), run.run_id);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "RUN_REQUIRES_RESUME" } });
      expect(store.toSnapshot()).toEqual(before);
    },
  );

  it("[セキュリティ境界] 他OwnerのRunはContinue・GETとも404で元Ownerを変更しない", async () => {
    const store = getOrbitStore(OWNER);
    const run = store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "owner-boundary" });
    const before = store.toSnapshot();
    vi.stubEnv("DEV_OWNER_USER_ID", "other-api-owner");

    const response = await continueBackgroundRun(continueRequest(run.run_id), run.run_id);
    const read = await getBackgroundRun(
      new Request(`https://orbit.example/api/v1/background-runs/${run.run_id}`),
      run.run_id,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
    expect(store.toSnapshot()).toEqual(before);
  });

  it("[異常系] running Runの不正Lockは423で処理しない", async () => {
    const store = getOrbitStore(OWNER);
    const run = store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "invalid-lock" });
    store.locks.get(OWNER)!.token = null;
    const before = store.toSnapshot();

    const response = await continueBackgroundRun(continueRequest(run.run_id), run.run_id);

    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ error: { code: "OPERATION_IN_PROGRESS" } });
    expect(store.toSnapshot()).toEqual(before);
  });

  it("[状態遷移] Lease期限ちょうどはpausedへ遷移しContinueは409を返す", async () => {
    const store = getOrbitStore(OWNER);
    const run = store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "expired-lease" });
    vi.advanceTimersByTime(30_000);

    const response = await continueBackgroundRun(continueRequest(run.run_id), run.run_id);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "RUN_REQUIRES_RESUME" } });
    expect(store.getRun(OWNER, run.run_id).status).toBe("paused");
    expect(store.locks.get(OWNER)?.status).toBe("idle");
  });

  it("[状態遷移] rejected RunへのContinueは409 BACKGROUND_RUN_REJECTEDを返す", async () => {
    const store = getOrbitStore(OWNER);
    store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "accepted-first" });
    expect(() =>
      store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "reject-second" }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    const rejected = [...store.runs.values()].find((run) => run.status === "rejected")!;
    const before = store.toSnapshot();

    const response = await continueBackgroundRun(continueRequest(rejected.run_id), rejected.run_id);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "BACKGROUND_RUN_REJECTED" } });
    expect(store.toSnapshot()).toEqual(before);
  });
});
