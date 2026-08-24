import { describe, expect, it } from "vitest";
import { cycleMetadataMutationSchema } from "./contracts";
import { calculateCycleMetrics, cycleTabForStatus } from "./cycle-workspace";

describe("Cycle workspace shared contract", () => {
  it("[境界値] nameOverrideはUnicode 1..100、descriptionは0..2000を受け入れる", () => {
    const base = { idempotencyKey: "cycle-meta-1" };
    expect(cycleMetadataMutationSchema.safeParse({ ...base, nameOverride: "" }).success).toBe(
      false,
    );
    expect(
      cycleMetadataMutationSchema.safeParse({ ...base, nameOverride: "あ", description: "" })
        .success,
    ).toBe(true);
    expect(
      cycleMetadataMutationSchema.safeParse({ ...base, nameOverride: "あ".repeat(100) }).success,
    ).toBe(true);
    expect(
      cycleMetadataMutationSchema.safeParse({ ...base, nameOverride: "あ".repeat(101) }).success,
    ).toBe(false);
    expect(
      cycleMetadataMutationSchema.safeParse({ ...base, nameOverride: "😀".repeat(100) }).success,
    ).toBe(true);
    expect(
      cycleMetadataMutationSchema.safeParse({ ...base, description: "あ".repeat(2_000) }).success,
    ).toBe(true);
    expect(
      cycleMetadataMutationSchema.safeParse({ ...base, description: "あ".repeat(2_001) }).success,
    ).toBe(false);
  });

  it("[同値分割] nameOverrideのnull / omittedは自動生成名への変更契約として受け入れる", () => {
    const base = { idempotencyKey: "cycle-meta-2" };
    expect(cycleMetadataMutationSchema.safeParse(base).success).toBe(true);
    expect(cycleMetadataMutationSchema.safeParse({ ...base, nameOverride: null }).success).toBe(
      true,
    );
  });

  it("[セキュリティ境界] 内部値や未知フィールドを受け入れない", () => {
    expect(
      cycleMetadataMutationSchema.safeParse({
        idempotencyKey: "cycle-meta-3",
        nameOverride: "Cycle",
        lock_token: "secret",
      }).success,
    ).toBe(false);
    expect(
      cycleMetadataMutationSchema.safeParse({
        idempotencyKey: "cycle-meta-3",
        nameOverride: "Cycle",
        status: "completed",
      }).success,
    ).toBe(false);
  });

  it("[同値分割] Cycle statusをCurrent / Upcoming / Pastへ分類する", () => {
    expect(cycleTabForStatus("active")).toBe("current");
    expect(cycleTabForStatus("upcoming")).toBe("upcoming");
    expect(cycleTabForStatus("completed")).toBe("past");
  });

  it("[境界値] 共通metricsはCanceledとnull estimateを扱う", () => {
    const metrics = calculateCycleMetrics(
      [
        { statusId: "started", estimate: null },
        { statusId: "done", estimate: 2 },
        { statusId: "canceled", estimate: 5 },
      ],
      [
        { id: "started", category: "started" },
        { id: "done", category: "completed" },
        { id: "canceled", category: "canceled" },
      ],
    );
    expect(metrics).toEqual({
      total: 3,
      completed: 1,
      canceled: 1,
      progressPercent: 50,
      estimateTotal: 2,
    });
  });
});
