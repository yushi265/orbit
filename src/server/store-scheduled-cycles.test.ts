import { describe, expect, it } from "vitest";
import type { Cycle } from "./model";
import { OrbitStore } from "./store";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function setup() {
  let now = NOW;
  const store = new OrbitStore(() => now);
  store.ensureOwner("owner", "owner@example.com");
  return {
    store,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

type Spec = { status: Cycle["status"]; startsAt: number; endsAt: number };

function seedCycles(store: OrbitStore, specs: Spec[]): Cycle[] {
  return specs.map((spec, index) => {
    const cycle: Cycle = {
      id: `cycle-${index + 1}`,
      userId: "owner",
      number: index + 1,
      name: `Cycle ${index + 1}`,
      nameOverride: null,
      description: "",
      startsAt: spec.startsAt,
      endsAt: spec.endsAt,
      status: spec.status,
      completedAt: null,
      scheduleOverridden: false,
    };
    store.cycles.set(cycle.id, cycle);
    return cycle;
  });
}

const counts = (store: OrbitStore) => ({
  cycles: store.cycles.size,
  history: store.cycleHistory.length,
  activities: store.activities.length,
  outbox: store.outbox.length,
});

describe("OrbitStore.runScheduledCycleTransitions", () => {
  it("[状態遷移] Activeが期限切れ → completedになり、次Cycleが無ければ作られる", () => {
    const { store } = setup();
    seedCycles(store, [{ status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY }]);

    const result = store.runScheduledCycleTransitions("owner");

    expect(result).toEqual({
      status: "done",
      processed: 1,
      hasRemaining: false,
      transitions: expect.any(Array),
    });
    expect(store.cycles.get("cycle-1")?.status).toBe("completed");
    expect(store.listCycles("owner").some((cycle) => cycle.number === 2)).toBe(true);
  });

  it("[同値分割] 繰越はcategory別に、backlog/completed/canceledは残りunstarted/startedは移動してversionが1増える", () => {
    const { store } = setup();
    const [active] = seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
      { status: "upcoming", startsAt: NOW + DAY, endsAt: NOW + 15 * DAY },
    ]);
    const states = store.ownedWorkflowStates("owner");
    const make = (category: string) => {
      const issue = store.createIssue("owner", {
        idempotencyKey: `issue-${category}`,
        title: `Issue ${category}`,
        cycleId: active.id,
        statusId: states.find((state) => state.category === category)!.id,
      });
      return { issue, version: issue.version };
    };
    const cases = ["backlog", "unstarted", "started", "completed", "canceled"].map((category) => ({
      category,
      ...make(category),
    }));

    store.runScheduledCycleTransitions("owner");

    for (const { category, issue, version } of cases) {
      const moves = category === "unstarted" || category === "started";
      expect(issue.cycleId).toBe(moves ? "cycle-2" : active.id);
      expect(issue.version).toBe(moves ? version + 1 : version);
    }
  });

  it("[代表値] 繰越履歴は移動したIssueごとに1件、Outbox cycle.completedは1件でmovedが移動件数", () => {
    const { store } = setup();
    const [active] = seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
      { status: "upcoming", startsAt: NOW + DAY, endsAt: NOW + 15 * DAY },
    ]);
    const unstarted = store.ownedWorkflowStates("owner").find((s) => s.category === "unstarted")!;
    for (const index of [0, 1, 2])
      store.createIssue("owner", {
        idempotencyKey: `move-${index}`,
        title: `Move ${index}`,
        cycleId: active.id,
        statusId: unstarted.id,
      });

    store.runScheduledCycleTransitions("owner");

    expect(store.cycleHistory).toHaveLength(3);
    const completed = store.outbox.filter((event) => event.type === "cycle.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].payload.moved).toBe(3);
  });

  it("[代表値] 終了処理のReceiptはidempotency key scheduled-<cycleId> / cycle.close で記録される", () => {
    const { store } = setup();
    const [active] = seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
      { status: "upcoming", startsAt: NOW + DAY, endsAt: NOW + 15 * DAY },
    ]);

    store.runScheduledCycleTransitions("owner");

    const receipt = store.receipts.get(`owner:scheduled-${active.id}`);
    expect(receipt?.operation).toBe("cycle.close");
  });

  it("[状態遷移] Activeなし・Upcomingが開始時刻到達 → activeになり startsAt/endsAt は不変", () => {
    const { store } = setup();
    seedCycles(store, [
      { status: "completed", startsAt: NOW - 28 * DAY, endsAt: NOW - 14 * DAY },
      { status: "upcoming", startsAt: NOW - DAY, endsAt: NOW + 13 * DAY },
    ]);

    const result = store.runScheduledCycleTransitions("owner");

    expect(result).toEqual({
      status: "done",
      processed: 1,
      hasRemaining: false,
      transitions: expect.any(Array),
    });
    const cycle = store.cycles.get("cycle-2")!;
    expect(cycle.status).toBe("active");
    expect([cycle.startsAt, cycle.endsAt]).toEqual([NOW - DAY, NOW + 13 * DAY]);
  });

  it("[代表値] 自動開始のActivityはsystem:automation・mutationKey scheduled-<id>-start、Outbox cycle.startedは1件", () => {
    const { store } = setup();
    seedCycles(store, [{ status: "upcoming", startsAt: NOW - DAY, endsAt: NOW + 13 * DAY }]);

    store.runScheduledCycleTransitions("owner");

    const started = store.activities.filter(
      (item) => item.entityType === "cycle" && item.action === "started",
    );
    expect(started).toHaveLength(1);
    expect(started[0].actorType).toBe("system:automation");
    expect(started[0].mutationKey).toBe("scheduled-cycle-1-start");
    const outbox = store.outbox.filter((event) => event.type === "cycle.started");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].dedupeKey).toBe("cycle.started:cycle-1");
    expect(outbox[0].payload).toEqual({
      cycleId: "cycle-1",
      startsAt: NOW - DAY,
      endsAt: NOW + 13 * DAY,
    });
  });

  it("[状態遷移] Activeが期限切れかつ次のUpcomingも開始時刻到達 → 1回で終了と開始の2件を処理", () => {
    const { store } = setup();
    seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - 1000 },
      { status: "upcoming", startsAt: NOW - 1000, endsAt: NOW + 14 * DAY },
    ]);

    const result = store.runScheduledCycleTransitions("owner");

    expect(result).toEqual({
      status: "done",
      processed: 2,
      hasRemaining: false,
      transitions: expect.any(Array),
    });
    expect(store.cycles.get("cycle-1")?.status).toBe("completed");
    expect(store.cycles.get("cycle-2")?.status).toBe("active");
  });

  it.each([
    [-1, 1, "completed"],
    [0, 1, "completed"],
    [1, 0, "active"],
  ])("[境界値] Active endsAtがnow%+d → processed=%d で status=%s", (offset, processed, status) => {
    const { store } = setup();
    seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW + offset },
      { status: "upcoming", startsAt: NOW + 5 * DAY, endsAt: NOW + 19 * DAY },
    ]);

    const result = store.runScheduledCycleTransitions("owner");

    expect(result).toMatchObject({ status: "done", processed });
    expect(store.cycles.get("cycle-1")?.status).toBe(status);
  });

  it.each([
    [-1, 1, "active"],
    [0, 1, "active"],
    [1, 0, "upcoming"],
  ])(
    "[境界値] Upcoming startsAtがnow%+d → processed=%d で status=%s",
    (offset, processed, status) => {
      const { store } = setup();
      seedCycles(store, [{ status: "upcoming", startsAt: NOW + offset, endsAt: NOW + 14 * DAY }]);

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({ status: "done", processed });
      expect(store.cycles.get("cycle-1")?.status).toBe(status);
    },
  );

  it.each([
    // [Active有無, Active期限切れ, Upcoming到達, 期待processed, 期待 cycle-1 の状態]
    ["Activeなし / - / 到達", false, false, true, 1, "active"],
    ["Activeなし / - / 未到達", false, false, false, 0, "upcoming"],
    ["Activeあり / 期限切れ / 到達", true, true, true, 2, "completed"],
    ["Activeあり / 期限切れ / 未到達", true, true, false, 1, "completed"],
    ["Activeあり / 期限内 / 到達", true, false, true, 0, "active"],
    ["Activeあり / 期限内 / 未到達", true, false, false, 0, "active"],
  ])(
    "[デシジョンテーブル] %s",
    (_label, hasActive, expired, reached, processed, firstCycleStatus) => {
      const { store } = setup();
      const specs: Spec[] = [];
      if (hasActive)
        specs.push({
          status: "active",
          startsAt: NOW - 14 * DAY,
          endsAt: expired ? NOW - 1000 : NOW + 2 * DAY,
        });
      specs.push({
        status: "upcoming",
        startsAt: reached ? NOW - 500 : NOW + 3 * DAY,
        endsAt: NOW + 20 * DAY,
      });
      seedCycles(store, specs);

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({ status: "done", processed });
      expect(store.cycles.get("cycle-1")?.status).toBe(firstCycleStatus);
    },
  );

  it("[状態遷移] 禁止遷移: completedは再処理されず、Active存在中にUpcomingはactiveにならない", () => {
    const { store } = setup();
    seedCycles(store, [
      { status: "completed", startsAt: NOW - 28 * DAY, endsAt: NOW - 14 * DAY },
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW + DAY },
      { status: "upcoming", startsAt: NOW - 1000, endsAt: NOW + 14 * DAY },
    ]);
    const before = counts(store);

    const result = store.runScheduledCycleTransitions("owner");

    expect(result).toEqual({
      status: "done",
      processed: 0,
      hasRemaining: false,
      transitions: [],
    });
    expect(store.cycles.get("cycle-1")?.status).toBe("completed");
    expect(store.cycles.get("cycle-3")?.status).toBe("upcoming");
    expect(counts(store)).toEqual(before);
  });

  it("[代表値] 同じ時刻で2回目を呼ぶとprocessed 0で件数が変わらない", () => {
    const { store } = setup();
    const [active] = seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
      { status: "upcoming", startsAt: NOW + DAY, endsAt: NOW + 15 * DAY },
    ]);
    store.createIssue("owner", { idempotencyKey: "i", title: "i", cycleId: active.id });
    store.runScheduledCycleTransitions("owner");
    const before = counts(store);

    const second = store.runScheduledCycleTransitions("owner");

    expect(second).toEqual({
      status: "done",
      processed: 0,
      hasRemaining: false,
      transitions: [],
    });
    expect(counts(store)).toEqual(before);
  });

  it.each([
    [1, "locked"],
    [0, "paused"],
  ])("[境界値] Lock leaseExpiresAtがnow+%d → %s", (offset, outcome) => {
    const { store } = setup();
    seedCycles(store, [{ status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY }]);
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "run" });
    const lock = store.locks.get("owner")!;
    lock.leaseExpiresAt = NOW + offset;
    run.leaseExpiresAt = NOW + offset;
    const before = counts(store);

    const result = store.runScheduledCycleTransitions("owner");

    if (outcome === "locked") {
      expect(result).toEqual({ status: "locked" });
      expect(counts(store)).toEqual(before);
      expect(store.cycles.get("cycle-1")?.status).toBe("active");
    } else {
      expect(result).toMatchObject({ status: "done", processed: 1 });
      expect(run.status).toBe("paused");
      expect(lock.status).toBe("idle");
      expect(store.cycles.get("cycle-1")?.status).toBe("completed");
    }
  });

  it("[代表値] lockedのときCycle・Issue・Outboxは不変", () => {
    const { store } = setup();
    const [active] = seedCycles(store, [
      { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
    ]);
    const issue = store.createIssue("owner", {
      idempotencyKey: "i",
      title: "i",
      cycleId: active.id,
    });
    store.startRun("owner", { kind: "maintenance", idempotencyKey: "run" });
    const before = JSON.stringify([store.cycles, store.issues, store.outbox].map((m) => [...m]));

    expect(store.runScheduledCycleTransitions("owner")).toEqual({ status: "locked" });

    expect(JSON.stringify([store.cycles, store.issues, store.outbox].map((m) => [...m]))).toBe(
      before,
    );
    expect(issue.cycleId).toBe(active.id);
  });

  it.each([
    [24, 24, false, 0],
    [25, 25, false, 0],
    [26, 25, true, 1],
  ])(
    "[境界値] 処理対象が%d件 → processed=%d hasRemaining=%s、残り%d件は次回で処理",
    (total, processed, hasRemaining, rest) => {
      const { store } = setup();
      // 遷移は close1, start2, close2, start3, ... の順。k番目の遷移は k <= total のときだけ時刻到達済みにする。
      const past = (offset: number) => NOW - 1000 * DAY + offset * DAY;
      const future = (offset: number) => NOW + offset * DAY;
      const specs: Spec[] = [{ status: "active", startsAt: past(0), endsAt: past(1) }];
      const lastCycle = Math.ceil(total / 2) + 2; // 末尾は必ず未到達のCycleを残す
      for (let number = 2; number <= lastCycle; number += 1) {
        const startReached = 2 * (number - 1) <= total;
        const endReached = 2 * (number - 1) + 1 <= total;
        specs.push({
          status: "upcoming",
          startsAt: startReached ? past(number) : future(number),
          endsAt: endReached ? past(number + 1) : future(number + 1),
        });
      }
      seedCycles(store, specs);

      const first = store.runScheduledCycleTransitions("owner");

      expect(first).toEqual({
        status: "done",
        processed,
        hasRemaining,
        transitions: expect.any(Array),
      });
      const second = store.runScheduledCycleTransitions("owner");
      expect(second).toMatchObject({ status: "done", processed: rest, hasRemaining: false });
    },
  );

  describe("transitions", () => {
    it("[代表値] 完了1件 → completedでmovedは移動したIssueの件数", () => {
      const { store } = setup();
      const [active] = seedCycles(store, [
        { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
        { status: "upcoming", startsAt: NOW + DAY, endsAt: NOW + 15 * DAY },
      ]);
      const unstarted = store.ownedWorkflowStates("owner").find((s) => s.category === "unstarted")!;
      for (const index of [0, 1])
        store.createIssue("owner", {
          idempotencyKey: `t-${index}`,
          title: `T ${index}`,
          cycleId: active.id,
          statusId: unstarted.id,
        });

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({
        status: "done",
        transitions: [{ type: "completed", cycleId: "cycle-1", name: "Cycle 1", moved: 2 }],
      });
    });

    it("[代表値] 別Ownerの同じdedupe keyのOutboxからmovedを読まない", () => {
      const { store } = setup();
      seedCycles(store, [{ status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY }]);
      store.outbox.push({
        id: "outbox-other",
        userId: "other",
        type: "cycle.completed",
        dedupeKey: "cycle.completed:cycle-1",
        payload: { cycleId: "cycle-1", moved: 9 },
        status: "pending",
        attemptCount: 0,
        createdAt: NOW,
      });

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({
        transitions: [{ type: "completed", cycleId: "cycle-1", moved: 0 }],
      });
    });

    it("[境界値] 移動するIssueが0件 → moved: 0", () => {
      const { store } = setup();
      seedCycles(store, [{ status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY }]);

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({
        transitions: [{ type: "completed", cycleId: "cycle-1", moved: 0 }],
      });
    });

    it("[代表値] 開始1件 → startedはmovedを持たない", () => {
      const { store } = setup();
      seedCycles(store, [{ status: "upcoming", startsAt: NOW - DAY, endsAt: NOW + 13 * DAY }]);

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toEqual({
        status: "done",
        processed: 1,
        hasRemaining: false,
        transitions: [{ type: "started", cycleId: "cycle-1", name: "Cycle 1" }],
      });
    });

    it("[代表値] 完了と開始 → 完了、開始の順", () => {
      const { store } = setup();
      seedCycles(store, [
        { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - 1000 },
        { status: "upcoming", startsAt: NOW - 1000, endsAt: NOW + 14 * DAY },
      ]);

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({
        transitions: [
          { type: "completed", cycleId: "cycle-1" },
          { type: "started", cycleId: "cycle-2" },
        ],
      });
    });

    it.each([
      ["nameOverrideあり", "Sprint X", "Sprint X"],
      ["nameOverrideなし", null, "Cycle 1"],
    ])("[同値分割] %s → nameが%s系", (_label, override, expected) => {
      const { store } = setup();
      const [cycle] = seedCycles(store, [
        { status: "upcoming", startsAt: NOW - DAY, endsAt: NOW + 13 * DAY },
      ]);
      cycle.nameOverride = override;

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({ transitions: [{ type: "started", name: expected }] });
    });

    it("[同値分割] 完了でもnameOverrideがnameより優先される", () => {
      const { store } = setup();
      const [cycle] = seedCycles(store, [
        { status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW - DAY },
      ]);
      cycle.nameOverride = "Sprint X";

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({ transitions: [{ type: "completed", name: "Sprint X" }] });
    });

    it("[代表値] 処理0件 → transitions: []。lockedはtransitionsを持たない", () => {
      const { store } = setup();
      seedCycles(store, [{ status: "active", startsAt: NOW - 14 * DAY, endsAt: NOW + DAY }]);

      expect(store.runScheduledCycleTransitions("owner")).toEqual({
        status: "done",
        processed: 0,
        hasRemaining: false,
        transitions: [],
      });
      store.startRun("owner", { kind: "maintenance", idempotencyKey: "run" });
      expect(store.runScheduledCycleTransitions("owner")).toEqual({ status: "locked" });
    });

    it("[境界値] 26件 → processedとtransitions.lengthがともに25", () => {
      const { store } = setup();
      const past = (offset: number) => NOW - 1000 * DAY + offset * DAY;
      const specs: Spec[] = [{ status: "active", startsAt: past(0), endsAt: past(1) }];
      for (let number = 2; number <= 15; number += 1)
        specs.push({
          status: "upcoming",
          startsAt: number <= 14 ? past(number) : NOW + 5 * DAY,
          endsAt: number <= 13 ? past(number + 1) : NOW + 6 * DAY,
        });
      seedCycles(store, specs);

      const result = store.runScheduledCycleTransitions("owner");

      expect(result).toMatchObject({ status: "done", processed: 25, hasRemaining: true });
      if (result.status === "done") expect(result.transitions).toHaveLength(25);
    });
  });

  it("[代表値] Manual Runによる予定開始のActivityはsystem:manual-run・mutationKey run-<runId>-<cycleId>-start のまま", () => {
    const { store } = setup();
    seedCycles(store, [{ status: "upcoming", startsAt: NOW - DAY, endsAt: NOW + 13 * DAY }]);
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "run" });

    store.continueRun("owner", run.run_id, { idempotencyKey: "step", expected_cursor: null });

    const started = store.activities.filter(
      (item) => item.entityType === "cycle" && item.action === "started",
    );
    expect(started).toHaveLength(1);
    expect(started[0].actorType).toBe("system:manual-run");
    expect(started[0].mutationKey).toBe(`run-${run.run_id}-cycle-1-start`);
  });
});
