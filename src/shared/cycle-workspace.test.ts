import { describe, expect, it } from "vitest";
import {
  cycleMetadataMutationSchema,
  cycleScheduleMutationSchema,
  cycleSettingsMutationSchema,
} from "./contracts";
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

  it("[境界値] CycleSettingsは期間1..8週と曜日0..6だけを受け入れる", () => {
    const base = { idempotencyKey: "cycle-settings-1" };
    expect(
      cycleSettingsMutationSchema.safeParse({ ...base, durationWeeks: 1, startWeekday: 0 }).success,
    ).toBe(true);
    expect(
      cycleSettingsMutationSchema.safeParse({ ...base, durationWeeks: 8, startWeekday: 6 }).success,
    ).toBe(true);
    for (const durationWeeks of [0, 9, 1.5, "2"]) {
      expect(
        cycleSettingsMutationSchema.safeParse({ ...base, durationWeeks, startWeekday: 1 }).success,
      ).toBe(false);
    }
    for (const startWeekday of [-1, 7, 1.5, "1"]) {
      expect(
        cycleSettingsMutationSchema.safeParse({ ...base, durationWeeks: 2, startWeekday }).success,
      ).toBe(false);
    }
  });

  it("[境界値] CycleSettingsはCooldown 0..4週と将来Cycle数1..15件を受け入れる", () => {
    const base = { idempotencyKey: "cycle-settings-advanced-1", durationWeeks: 2, startWeekday: 1 };

    expect(
      cycleSettingsMutationSchema.safeParse({ ...base, cooldownWeeks: 0, futureCount: 1 }).success,
    ).toBe(true);
    expect(
      cycleSettingsMutationSchema.safeParse({ ...base, cooldownWeeks: 4, futureCount: 15 }).success,
    ).toBe(true);
    for (const cooldownWeeks of [-1, 5, 1.5, "2"]) {
      expect(
        cycleSettingsMutationSchema.safeParse({ ...base, cooldownWeeks, futureCount: 3 }).success,
      ).toBe(false);
    }
    for (const futureCount of [0, 16, 1.5, "3"]) {
      expect(
        cycleSettingsMutationSchema.safeParse({ ...base, cooldownWeeks: 1, futureCount }).success,
      ).toBe(false);
    }
  });

  it("[同値分割] CycleSettingsは自動追加booleanを受け入れ、boolean以外を拒否する", () => {
    const base = { idempotencyKey: "cycle-settings-auto-add", durationWeeks: 2, startWeekday: 1 };
    expect(
      cycleSettingsMutationSchema.safeParse({ ...base, autoAddToCurrentCycle: false }).success,
    ).toBe(true);
    expect(
      cycleSettingsMutationSchema.safeParse({ ...base, autoAddToCurrentCycle: true }).success,
    ).toBe(true);
    for (const autoAddToCurrentCycle of ["true", 1, 0, null]) {
      expect(
        cycleSettingsMutationSchema.safeParse({ ...base, autoAddToCurrentCycle }).success,
      ).toBe(false);
    }
  });

  it("[境界値] Cycle scheduleはYYYY-MM-DDだけを受け入れ、未知フィールドを拒否する", () => {
    const base = {
      idempotencyKey: "cycle-schedule-contract-1",
      startDate: "2026-01-01",
      endDate: "2026-01-08",
    };

    expect(cycleScheduleMutationSchema.safeParse(base).success).toBe(true);
    expect(
      cycleScheduleMutationSchema.safeParse({
        ...base,
        startDate: "2026-12-31",
        endDate: "2027-01-01",
      }).success,
    ).toBe(true);
    for (const [startDate, endDate] of [
      ["2026-1-1", "2026-01-08"],
      ["2026-02-30", "2026-03-01"],
      ["2026-01-01", "2026-1-8"],
    ]) {
      expect(cycleScheduleMutationSchema.safeParse({ ...base, startDate, endDate }).success).toBe(
        false,
      );
    }
    for (const field of ["scheduleOverridden", "startsAt", "lock_token"]) {
      expect(cycleScheduleMutationSchema.safeParse({ ...base, [field]: true }).success).toBe(false);
    }
    expect(
      cycleScheduleMutationSchema.safeParse({ ...base, idempotencyKey: "a".repeat(201) }).success,
    ).toBe(false);
  });

  it("[デシジョンテーブル] CycleSettingsはunknown keyと不正idempotencyKeyを拒否する", () => {
    const valid = { idempotencyKey: "cycle-settings-2", durationWeeks: 2, startWeekday: 1 };
    expect(cycleSettingsMutationSchema.safeParse(valid).success).toBe(true);
    expect(cycleSettingsMutationSchema.safeParse({ ...valid, lock_token: "secret" }).success).toBe(
      false,
    );
    expect(cycleSettingsMutationSchema.safeParse({ ...valid, idempotencyKey: "" }).success).toBe(
      false,
    );
    expect(
      cycleSettingsMutationSchema.safeParse({ ...valid, idempotencyKey: "a".repeat(201) }).success,
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
