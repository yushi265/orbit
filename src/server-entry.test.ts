import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchHandler, runScheduledCycles } = vi.hoisted(() => ({
  fetchHandler: vi.fn(),
  runScheduledCycles: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: fetchHandler } }));
vi.mock("./server/scheduled-cycles", () => ({ runScheduledCycles }));

import type { ScheduledController } from "@cloudflare/workers-types";
import worker from "./server";

const controller = {} as ScheduledController;

describe("Worker entry (src/server.ts)", () => {
  beforeEach(() => {
    runScheduledCycles.mockReset();
  });

  it("[代表値] default exportのfetchがserver-entryのfetchと同一参照", () => {
    expect(worker.fetch).toBe(fetchHandler);
  });

  it("[代表値] scheduled(controller, env)がrunScheduledCyclesをenvで1回呼び、完了を待つ", async () => {
    let finished = false;
    runScheduledCycles.mockImplementation(async () => {
      await Promise.resolve();
      finished = true;
    });
    const env = { APP_ENV: "production" };

    await worker.scheduled(controller, env);

    expect(runScheduledCycles).toHaveBeenCalledTimes(1);
    expect(runScheduledCycles).toHaveBeenCalledWith(env);
    expect(finished).toBe(true);
  });

  it("[代表値] runScheduledCyclesが例外を投げたらscheduledも同じ例外で失敗する", async () => {
    const failure = new Error("boom");
    runScheduledCycles.mockRejectedValue(failure);

    await expect(worker.scheduled(controller, {})).rejects.toBe(failure);
  });
});
