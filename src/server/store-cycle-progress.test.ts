import { describe, expect, it, vi } from "vitest";
import { json, withOwner } from "./http";
import { OrbitStore } from "./store";
import { cycleProgressSchema } from "../shared/contracts";

// CYC-16 AC-1〜4: Mutation後の日別進捗記録、Cycle完了での確定、Bootstrap公開、Snapshot互換
const DAY = 86_400_000;
// 2026-11-16 (Mon) 12:00 JST
const START = Date.UTC(2026, 10, 16, 3);

function setup() {
  let now = START;
  const store = new OrbitStore(() => now);
  store.ensureOwner("owner", "owner@example.com");
  store.bootstrap("owner");
  store.updateCycleSettings("owner", {
    idempotencyKey: "progress-settings",
    durationWeeks: 2,
    startWeekday: 1,
  });
  const active = store.listCycles("owner").find((cycle) => cycle.status === "active")!;
  const status = (category: "unstarted" | "started" | "completed" | "canceled") =>
    store.ownedWorkflowStates("owner").find((state) => state.category === category)!.id;
  let seq = 0;
  const create = (cycleId: string | null = active.id) =>
    store.createIssue("owner", {
      idempotencyKey: `progress-create-${++seq}`,
      title: `Issue ${seq}`,
      statusId: status("unstarted"),
      cycleId,
    });
  const update = (id: string, patch: Parameters<OrbitStore["updateIssue"]>[1]["patch"]) =>
    store.updateIssue("owner", {
      id,
      version: store.getIssue("owner", id).version,
      idempotencyKey: `progress-update-${++seq}`,
      patch,
    });
  return {
    store,
    active,
    status,
    create,
    update,
    advance: (ms: number) => (now += ms),
    now: () => now,
    record: () => store.cycleProgress.find((item) => item.cycleId === active.id),
    progress: () => store.bootstrap("owner").cycleProgress.find((p) => p.cycleId === active.id),
  };
}

describe("recordCycleProgress", () => {
  it("[状態遷移] 初回はbaseline、同日の追加・完了・Cancelを1点に畳み込む", () => {
    const t = setup();
    const a = t.create();
    t.create();
    t.store.recordCycleProgress("owner");
    expect(t.record()!.points).toEqual([
      expect.objectContaining({ scope: 2, completed: 0, canceled: 0, added: 0, removed: 0 }),
    ]);
    const c = t.create();
    t.update(a.id, { statusId: t.status("completed") });
    t.update(c.id, { statusId: t.status("canceled") });
    t.store.recordCycleProgress("owner");
    expect(t.record()!.points).toHaveLength(1);
    expect(t.record()!.points[0]).toMatchObject({ scope: 3, completed: 1, canceled: 1, added: 1 });
  });

  it("[代表値] 所属から外す・Archive・Trashは removed、Restoreで added", () => {
    const t = setup();
    const [a, b, c] = [t.create(), t.create(), t.create()];
    t.store.recordCycleProgress("owner");
    t.advance(DAY);
    t.update(a.id, { cycleId: null });
    t.store.archiveIssue("owner", b.id, "progress-archive");
    t.store.trashIssue("owner", c.id, "progress-trash");
    t.store.recordCycleProgress("owner");
    expect(t.record()!.points.at(-1)).toMatchObject({ scope: 0, added: 0, removed: 3 });
    t.store.restoreIssue("owner", b.id, "progress-restore");
    t.store.recordCycleProgress("owner");
    expect(t.record()!.points.at(-1)).toMatchObject({ scope: 1, added: 1, removed: 3 });
  });

  it("[代表値] 一括更新で所属と完了をまとめて変えても1日1点で記録する", () => {
    const t = setup();
    const a = t.create();
    const free = t.create(null);
    t.store.recordCycleProgress("owner");
    t.advance(DAY);
    t.store.bulkUpdateIssues("owner", {
      idempotencyKey: "progress-bulk-cycle",
      issueIds: [a.id, free.id],
      patch: { cycleId: t.active.id },
    });
    t.store.bulkUpdateIssues("owner", {
      idempotencyKey: "progress-bulk-status",
      issueIds: [a.id, free.id],
      patch: { statusId: t.status("completed") },
    });
    t.store.recordCycleProgress("owner");
    expect(t.record()!.points).toHaveLength(2);
    expect(t.record()!.points.at(-1)).toMatchObject({ scope: 2, completed: 2, added: 1 });
  });

  it("[代表値] 値が変わらなければ記録しない（翌日でも点を増やさない）", () => {
    const t = setup();
    t.create();
    t.store.recordCycleProgress("owner");
    const before = structuredClone(t.store.cycleProgress);
    t.advance(DAY);
    t.store.recordCycleProgress("owner");
    expect(t.store.cycleProgress).toEqual(before);
  });

  it("[代表値] Upcoming Cycle は記録しない", () => {
    const t = setup();
    t.store.recordCycleProgress("owner");
    const upcoming = t.store.listCycles("owner").filter((cycle) => cycle.status === "upcoming");
    expect(upcoming.length).toBeGreaterThan(0);
    expect(t.store.cycleProgress.map((item) => item.cycleId)).toEqual([t.active.id]);
  });

  it("[状態遷移] Cycle完了は完了前の所属で確定し、繰越先は開始時の所属をbaselineにする", () => {
    const t = setup();
    const done = t.create();
    t.create();
    t.store.recordCycleProgress("owner");
    t.advance(DAY);
    t.update(done.id, { statusId: t.status("completed") });
    const next = t.store.listCycles("owner").find((cycle) => cycle.number === t.active.number + 1)!;
    t.store.startCycle("owner", next.id, "progress-start-next");
    t.store.recordCycleProgress("owner");
    const closed = t.record()!;
    expect(closed.closed).toBe(true);
    expect(closed.points.at(-1)).toMatchObject({ scope: 2, completed: 1, removed: 0 });
    const nextRecord = t.store.cycleProgress.find((item) => item.cycleId === next.id)!;
    expect(nextRecord.points).toEqual([
      expect.objectContaining({ scope: 1, added: 0, removed: 0 }),
    ]);
    t.advance(DAY);
    t.create(null);
    t.store.recordCycleProgress("owner");
    expect(t.record()).toEqual(closed);
  });
});

describe("bootstrap cycleProgress", () => {
  it("[代表値] 本人のActive / 完了Cycleの日別進捗を公開schemaどおり返す", () => {
    const t = setup();
    t.create();
    t.store.recordCycleProgress("owner");
    const progress = t.progress()!;
    expect(cycleProgressSchema.parse(progress)).toEqual(progress);
    expect(progress.trackedFrom).toBe("2026-11-16");
    expect(progress.days.at(-1)).toMatchObject({ date: "2026-11-16", scope: 1, remaining: 1 });
  });

  it("[代表値] 記録がないCycle・参照先Cycleがない記録は返さない", () => {
    const t = setup();
    expect(t.store.bootstrap("owner").cycleProgress).toEqual([]);
    t.create();
    t.store.recordCycleProgress("owner");
    t.store.cycleProgress.push({ ...t.record()!, cycleId: "missing-cycle" });
    expect(t.store.bootstrap("owner").cycleProgress.map((p) => p.cycleId)).toEqual([t.active.id]);
  });

  it("[代表値] 別Ownerの記録は返さない", () => {
    const t = setup();
    t.create();
    t.store.recordCycleProgress("owner");
    t.store.ensureOwner("other", "other@example.com");
    t.store.bootstrap("other");
    expect(t.store.bootstrap("other").cycleProgress).toEqual([]);
  });
});

describe("snapshot", () => {
  it("[代表値] round-tripで同じ cycleProgress、旧Snapshot（キーなし）は空配列", () => {
    const t = setup();
    t.create();
    t.store.recordCycleProgress("owner");
    const snapshot = t.store.toSnapshot();
    const restored = OrbitStore.fromSnapshot(snapshot, t.now, "owner");
    expect(restored.cycleProgress).toEqual(t.store.cycleProgress);
    const legacy = structuredClone(snapshot) as Partial<typeof snapshot>;
    delete legacy.cycleProgress;
    expect(OrbitStore.fromSnapshot(legacy, t.now, "owner").cycleProgress).toEqual([]);
  });

  it("[代表値] 別Ownerの cycleProgress を含むSnapshotは拒否する", () => {
    const t = setup();
    t.create();
    t.store.recordCycleProgress("owner");
    const snapshot = t.store.toSnapshot();
    snapshot.cycleProgress[0].userId = "other";
    expect(() => OrbitStore.fromSnapshot(snapshot, t.now, "owner")).toThrow();
  });
});

describe("withOwner", () => {
  const environment = async () => ({ APP_ENV: "development", ORBIT_STORAGE: "memory" });
  async function call(method: string, ok = true) {
    const store = new OrbitStore();
    const record = vi.spyOn(store, "recordCycleProgress").mockImplementation(() => undefined);
    const persist = vi.fn(async () => {});
    await withOwner(
      new Request("https://orbit.example/api/v1/issues", {
        method,
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      async () => json({ ok }, ok ? 200 : 409),
      {
        runtimeEnv: environment,
        resolveOwner: async () => ({
          userId: "owner",
          email: "owner@example.com",
          accessAuthenticated: true,
        }),
        openStoreSession: async () => ({ store, persist, needsInitialPersist: false }),
      },
    );
    return { record, persist };
  }

  it.each([
    ["POST", true, 1],
    ["PATCH", true, 1],
    ["GET", true, 0],
    ["POST", false, 0],
  ])("[デシジョンテーブル] %s × 成功=%s → 記録 %i 回（保存より前）", async (method, ok, times) => {
    const { record, persist } = await call(method, ok);
    expect(record).toHaveBeenCalledTimes(times);
    if (times) {
      expect(record).toHaveBeenCalledWith("owner");
      expect(record.mock.invocationCallOrder[0]).toBeLessThan(persist.mock.invocationCallOrder[0]);
    }
  });
});
