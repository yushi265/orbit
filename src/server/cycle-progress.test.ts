import { describe, expect, it } from "vitest";
import {
  expandCycleProgress,
  localDateKey,
  observeCycleProgress,
  type CycleProgressRecord,
} from "./cycle-progress";

// CYC-16 AC-1〜3: 日別進捗の記録ルールと日別展開（純関数）
const observation = (
  date: string,
  issueIds: string[],
  completed = 0,
  canceled = 0,
): Parameters<typeof observeCycleProgress>[1] => ({
  userId: "owner",
  cycleId: "cycle-1",
  date,
  issueIds,
  completed,
  canceled,
});

describe("localDateKey", () => {
  it("[境界値] Asia/Tokyoで 14:59:59Z と 15:00:00Z は別の日付", () => {
    expect(localDateKey(Date.UTC(2026, 10, 13, 14, 59, 59), "Asia/Tokyo")).toBe("2026-11-13");
    expect(localDateKey(Date.UTC(2026, 10, 13, 15, 0, 0), "Asia/Tokyo")).toBe("2026-11-14");
  });
  it("[代表値] 不正なtimezoneはUTCで丸める", () => {
    expect(localDateKey(Date.UTC(2026, 10, 13, 23, 0), "Not/AZone")).toBe("2026-11-13");
  });
});

describe("observeCycleProgress", () => {
  it("[状態遷移] 記録なし → 初回はbaseline（added 0）で trackedFrom を当日にする", () => {
    const record = observeCycleProgress(undefined, observation("2026-11-14", ["a", "b"], 1));
    expect(record).toEqual({
      userId: "owner",
      cycleId: "cycle-1",
      trackedFrom: "2026-11-14",
      lastIssueIds: ["a", "b"],
      closed: false,
      points: [{ date: "2026-11-14", scope: 2, completed: 1, canceled: 0, added: 0, removed: 0 }],
    });
  });

  const base = observeCycleProgress(undefined, observation("2026-11-14", ["a", "b"]))!;

  it.each([
    ["同日", "2026-11-14", false, null],
    ["翌日", "2026-11-15", false, null],
  ])("[デシジョンテーブル] %s × 値変化なし → 書かない(null)", (_label, date) => {
    expect(observeCycleProgress(base, observation(date, ["b", "a"]))).toBeNull();
  });

  it("[デシジョンテーブル] 同日 × 値変化あり → 最終点を上書きし added を加算", () => {
    const next = observeCycleProgress(base, observation("2026-11-14", ["a", "b", "c"], 1))!;
    expect(next.points).toEqual([
      { date: "2026-11-14", scope: 3, completed: 1, canceled: 0, added: 1, removed: 0 },
    ]);
    expect(next.lastIssueIds).toEqual(["a", "b", "c"]);
    expect(next.trackedFrom).toBe("2026-11-14");
  });

  it("[デシジョンテーブル] 翌日 × 値変化あり → 新しい点を追加", () => {
    const next = observeCycleProgress(base, observation("2026-11-15", ["a"], 0, 1))!;
    expect(next.points.at(-1)).toEqual({
      date: "2026-11-15",
      scope: 1,
      completed: 0,
      canceled: 1,
      added: 0,
      removed: 1,
    });
    expect(next.points).toHaveLength(2);
  });

  it("[代表値] 同日に追加して外す → added 1・removed 1（scopeは不変でも記録する）", () => {
    const added = observeCycleProgress(base, observation("2026-11-15", ["a", "b", "c"]))!;
    const removed = observeCycleProgress(added, observation("2026-11-15", ["a", "b"]))!;
    expect(removed.points.at(-1)).toMatchObject({ scope: 2, added: 1, removed: 1 });
  });

  it("[代表値] 完了状態の変化だけでも記録する", () => {
    const next = observeCycleProgress(base, observation("2026-11-15", ["a", "b"], 1))!;
    expect(next.points.at(-1)).toMatchObject({ completed: 1, added: 0, removed: 0 });
  });

  it("[状態遷移] close で closed になり、以後は記録しない", () => {
    const closed = observeCycleProgress(base, observation("2026-11-14", ["a", "b"]), {
      close: true,
    })!;
    expect(closed.closed).toBe(true);
    expect(closed.points).toEqual(base.points);
    expect(closed.lastIssueIds).toEqual([]);
    expect(observeCycleProgress(closed, observation("2026-11-15", ["a"]))).toBeNull();
    expect(
      observeCycleProgress(closed, observation("2026-11-15", ["a"]), { close: true }),
    ).toBeNull();
  });

  it("[代表値] 入力のrecordを書き換えない", () => {
    const before = structuredClone(base);
    observeCycleProgress(base, observation("2026-11-14", ["a"]));
    expect(base).toEqual(before);
  });
});

describe("expandCycleProgress", () => {
  const record: CycleProgressRecord = {
    userId: "owner",
    cycleId: "cycle-1",
    trackedFrom: "2026-11-11",
    lastIssueIds: ["a", "b", "c"],
    closed: false,
    points: [
      { date: "2026-11-11", scope: 4, completed: 0, canceled: 0, added: 0, removed: 0 },
      { date: "2026-11-13", scope: 3, completed: 1, canceled: 1, added: 0, removed: 1 },
    ],
  };
  const tz = "Asia/Tokyo";
  // 11/10 00:00 JST 〜 11/23 23:59 JST
  const cycle = {
    startsAt: Date.UTC(2026, 10, 9, 15),
    endsAt: Date.UTC(2026, 10, 23, 14, 59),
    status: "active" as const,
    completedAt: null,
  };

  it("[代表値] 開始日〜今日の全日を昇順で返し、trackedFrom前はtracked:false・数値null", () => {
    const result = expandCycleProgress(record, cycle, Date.UTC(2026, 10, 14, 3), tz);
    expect(result.cycleId).toBe("cycle-1");
    expect(result.trackedFrom).toBe("2026-11-11");
    expect(result.days.map((day) => day.date)).toEqual([
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
    expect(result.days[0]).toEqual({
      date: "2026-11-10",
      tracked: false,
      scope: null,
      completed: null,
      canceled: null,
      remaining: null,
      added: null,
      removed: null,
    });
  });

  it("[代表値] 記録のない日は直前の値を引き継ぎ added/removed は0、remaining = scope-completed-canceled", () => {
    const days = expandCycleProgress(record, cycle, Date.UTC(2026, 10, 14, 3), tz).days;
    expect(days[2]).toEqual({
      date: "2026-11-12",
      tracked: true,
      scope: 4,
      completed: 0,
      canceled: 0,
      remaining: 4,
      added: 0,
      removed: 0,
    });
    expect(days[3]).toMatchObject({ scope: 3, remaining: 1, removed: 1 });
    expect(days[4]).toMatchObject({ scope: 3, remaining: 1, added: 0, removed: 0 });
  });

  it("[境界値] 今日が終了日を過ぎていても endsAt の日までで止める", () => {
    const days = expandCycleProgress(record, cycle, Date.UTC(2026, 10, 30), tz).days;
    expect(days.at(-1)!.date).toBe("2026-11-23");
    expect(days).toHaveLength(14);
  });

  it("[境界値] 開始日が今日 → 1日だけ", () => {
    const today = { ...record, trackedFrom: "2026-11-10", points: [record.points[0]] };
    today.points = [{ ...today.points[0], date: "2026-11-10" }];
    const days = expandCycleProgress(today, cycle, Date.UTC(2026, 10, 10, 3), tz).days;
    expect(days.map((day) => day.date)).toEqual(["2026-11-10"]);
  });

  it("[境界値] 完了Cycleは completedAt の日までで止める", () => {
    const completed = {
      ...cycle,
      status: "completed" as const,
      completedAt: Date.UTC(2026, 10, 12, 1),
    };
    const days = expandCycleProgress(record, completed, Date.UTC(2026, 10, 30), tz).days;
    expect(days.at(-1)!.date).toBe("2026-11-12");
  });
});
