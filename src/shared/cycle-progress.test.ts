import { describe, expect, it } from "vitest";
import { cycleProgressSchema } from "./contracts";

// CYC-16 AC-2 / AC-4: Bootstrapの cycleProgress 公開契約
const trackedDay = {
  date: "2026-11-14",
  tracked: true,
  scope: 5,
  completed: 2,
  canceled: 1,
  remaining: 2,
  added: 1,
  removed: 0,
};
const untrackedDay = {
  date: "2026-11-13",
  tracked: false,
  scope: null,
  completed: null,
  canceled: null,
  remaining: null,
  added: null,
  removed: null,
};
const progress = (days: unknown[]) => ({ cycleId: "cycle-1", trackedFrom: "2026-11-14", days });
const ok = (value: unknown) => cycleProgressSchema.safeParse(value).success;

describe("cycleProgressSchema", () => {
  it("[同値分割] tracked:trueの正常日・tracked:falseで数値nullの日 → 成功", () => {
    expect(ok(progress([untrackedDay, trackedDay]))).toBe(true);
  });
  it.each([
    [0, true],
    [-1, false],
    [1.5, false],
  ])("[境界値] scope %s → %s", (scope, expected) => {
    expect(
      ok(progress([{ ...trackedDay, scope, completed: 0, canceled: 0, remaining: scope }])),
    ).toBe(expected);
  });
  it.each([
    [true, "数値", true],
    [true, "null", false],
    [false, "null", true],
    [false, "数値", false],
  ])("[デシジョンテーブル] tracked=%s × %s", (tracked, values, expected) => {
    const base = values === "数値" ? trackedDay : untrackedDay;
    expect(ok(progress([{ ...base, tracked }]))).toBe(expected);
  });
  it("[代表値] remaining が scope-completed-canceled と不一致 → 失敗", () => {
    expect(ok(progress([{ ...trackedDay, remaining: 3 }]))).toBe(false);
  });
  it.each([
    ["2026-11-14", true],
    ["2026-11-4", false],
    ["2026-02-30", false],
  ])("[境界値] date %s → %s", (date, expected) => {
    expect(ok(progress([{ ...trackedDay, date }]))).toBe(expected);
    expect(ok({ ...progress([trackedDay]), trackedFrom: date })).toBe(expected);
  });
  it("[代表値] 未知キー・days空 → 失敗", () => {
    expect(ok({ ...progress([trackedDay]), extra: 1 })).toBe(false);
    expect(ok(progress([{ ...trackedDay, extra: 1 }]))).toBe(false);
    expect(ok(progress([]))).toBe(false);
  });
});
