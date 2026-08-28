import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  const states = store.ownedWorkflowStates("owner");
  const cycle = {
    id: "cycle-active",
    userId: "owner",
    number: 1,
    name: "Cycle 1",
    nameOverride: null,
    description: "初期説明",
    startsAt: 1_699_000_000_000,
    endsAt: 1_701_000_000_000,
    status: "active" as const,
    completedAt: null,
    scheduleOverridden: false,
  };
  store.cycles.set(cycle.id, cycle);
  return { store, cycle, states };
}

describe("Cycle workspace service", () => {
  it("[状態遷移] Cycle設定保存でUpcomingだけをTimezone基準に再計算し、Active・Past・overrideを保持する", () => {
    const { store, cycle } = setup();
    const past = {
      ...cycle,
      id: "cycle-past-settings",
      number: 0,
      status: "completed" as const,
      startsAt: 1,
      endsAt: 2,
      completedAt: 2,
    };
    store.cycles.set(past.id, past);
    store.bootstrap("owner");
    const activeBefore = structuredClone(cycle);
    const upcoming = store
      .listCycles("owner")
      .filter((item) => item.status === "upcoming")
      .sort((left, right) => left.number - right.number);
    const overridden = upcoming[1];
    overridden.scheduleOverridden = true;
    overridden.startsAt = 1_702_000_000_000;
    overridden.endsAt = 1_702_604_800_000;
    const overriddenBefore = structuredClone(overridden);
    const pastBefore = structuredClone(past);

    const updated = store.updateCycleSettings("owner", {
      idempotencyKey: "cycle-settings-update-1",
      durationWeeks: 1,
      startWeekday: 5,
    });

    expect(updated).toMatchObject({ durationWeeks: 1, startWeekday: 5 });
    expect(store.cycles.get(cycle.id)).toEqual(activeBefore);
    expect(store.cycles.get(past.id)).toEqual(pastBefore);
    expect(store.cycles.get(overridden.id)).toEqual(overriddenBefore);
    const automatic = store
      .listCycles("owner")
      .filter((item) => item.status === "upcoming" && !item.scheduleOverridden)
      .sort((left, right) => left.number - right.number);
    expect(automatic[0].endsAt - automatic[0].startsAt).toBe(7 * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(automatic[0].startsAt));
    expect(Object.fromEntries(parts.map((part) => [part.type, part.value]))).toMatchObject({
      weekday: "Fri",
      hour: "00",
      minute: "00",
    });
  });

  it("[デシジョンテーブル] Cycle設定の不正値・再送・lock中を拒否または冪等に扱う", () => {
    const { store } = setup();
    store.bootstrap("owner");
    const beforeInvalid = store.toSnapshot();

    expect(() =>
      store.updateCycleSettings("owner", {
        idempotencyKey: "cycle-settings-invalid",
        durationWeeks: 0,
        startWeekday: 1,
      } as never),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR", status: 400 }));
    expect(store.toSnapshot()).toEqual(beforeInvalid);

    const input = {
      idempotencyKey: "cycle-settings-replay",
      durationWeeks: 3,
      startWeekday: 2,
    };
    const updated = store.updateCycleSettings("owner", input);
    const activityCount = store.activities.length;
    const outboxCount = store.outbox.length;
    const replay = store.updateCycleSettings("owner", input);
    expect(replay).toEqual(updated);
    expect(store.activities).toHaveLength(activityCount);
    expect(store.outbox).toHaveLength(outboxCount);
    expect(() =>
      store.updateCycleSettings("owner", {
        ...input,
        durationWeeks: 4,
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 }));

    const locked = setup().store;
    const beforeLocked = locked.toSnapshot();
    locked.startRun("owner", { kind: "maintenance", idempotencyKey: "cycle-settings-lock-run" });
    expect(() => locked.updateCycleSettings("owner", input)).toThrowError(
      expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }),
    );
    expect(locked.toSnapshot()).toMatchObject({
      cycleSettings: beforeLocked.cycleSettings,
      cycles: beforeLocked.cycles,
    });
  });

  it("[状態遷移] 設定変更後にcloseで生成するUpcomingも新しい期間と開始曜日を使う", () => {
    const { store, cycle } = setup();
    store.updateCycleSettings("owner", {
      idempotencyKey: "cycle-settings-close",
      durationWeeks: 1,
      startWeekday: 2,
    });

    expect(store.closeCycle("owner", cycle.id, "cycle-close-after-settings")).toMatchObject({
      status: "completed",
    });
    const next = store.listCycles("owner").find((item) => item.number === 2)!;
    expect(next).toMatchObject({ status: "upcoming", number: 2 });
    expect(next.endsAt - next.startsAt).toBe(7 * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(next.startsAt));
    expect(Object.fromEntries(parts.map((part) => [part.type, part.value]))).toMatchObject({
      weekday: "Tue",
      hour: "00",
      minute: "00",
    });
  });

  it("[状態遷移] 保存したCooldownをUpcomingの再計算へ適用し、保護対象を変更しない", () => {
    const { store, cycle } = setup();
    const past = {
      ...cycle,
      id: "cycle-past-cooldown",
      number: 0,
      status: "completed" as const,
      startsAt: 1,
      endsAt: 2,
      completedAt: 2,
    };
    store.cycles.set(past.id, past);
    const first = store.bootstrap("owner");
    const upcoming = first.cycles
      .filter((item) => item.status === "upcoming")
      .sort((left, right) => left.number - right.number);
    upcoming[1].scheduleOverridden = true;
    upcoming[1].startsAt = 1_702_000_000_000;
    upcoming[1].endsAt = 1_702_604_800_000;
    const activeBefore = structuredClone(cycle);
    const pastBefore = structuredClone(past);
    const overrideBefore = structuredClone(upcoming[1]);

    const updated = store.updateCycleSettings("owner", {
      idempotencyKey: "cycle-settings-cooldown",
      durationWeeks: 2,
      startWeekday: 1,
      cooldownWeeks: 1,
      futureCount: 3,
    });

    expect(updated).toMatchObject({ cooldownWeeks: 1, futureCount: 3 });
    expect(store.cycles.get(cycle.id)).toEqual(activeBefore);
    expect(store.cycles.get(past.id)).toEqual(pastBefore);
    expect(store.cycles.get(upcoming[1].id)).toEqual(overrideBefore);
    expect(store.cycles.get(upcoming[0].id)).toMatchObject({
      startsAt: 1_701_615_600_000,
      endsAt: 1_702_825_200_000,
    });
    expect(store.outbox.at(-1)?.payload).toMatchObject({
      durationWeeks: 2,
      startWeekday: 1,
      cooldownWeeks: 1,
      futureCount: 3,
    });
  });

  it("[状態遷移] Cycle完了後に生成するUpcomingへ保存したCooldownを適用する", () => {
    const { store, cycle } = setup();
    store.updateCycleSettings("owner", {
      idempotencyKey: "cycle-settings-close-cooldown",
      durationWeeks: 2,
      startWeekday: 1,
      cooldownWeeks: 1,
      futureCount: 3,
    });

    store.closeCycle("owner", cycle.id, "cycle-close-cooldown");
    const next = store.listCycles("owner").find((item) => item.number === 2)!;

    expect(next).toMatchObject({ status: "upcoming", number: 2 });
    expect(next.startsAt).toBe(1_701_615_600_000);
    expect(next.endsAt).toBe(1_702_825_200_000);
  });

  it("[代表値] Cycle 0件のBootstrapでActive Cycle 1とUpcomingを作成し、再実行で増やさない", () => {
    const store = new OrbitStore(() => 1_700_000_000_000);

    store.ensureOwner("owner", "owner@example.com");
    const first = store.bootstrap("owner");
    const active = first.cycles.find((cycle) => cycle.status === "active");
    const upcoming = first.cycles.filter((cycle) => cycle.status === "upcoming");

    expect(active).toMatchObject({
      number: 1,
      name: "Cycle 1",
      status: "active",
      startsAt: 1_700_000_000_000,
      endsAt: 1_700_000_000_000 + 2 * 7 * 24 * 60 * 60 * 1000,
    });
    expect(upcoming.map((cycle) => cycle.number)).toEqual([2, 3, 4]);

    const second = store.bootstrap("owner");
    expect(second.cycles).toEqual(first.cycles);
  });

  it("[境界値] 初期Active Cycleの終了日時はdurationWeeks 1と8に追従する", () => {
    for (const durationWeeks of [1, 8]) {
      const store = new OrbitStore(() => 1_700_000_000_000);
      store.ensureOwner("owner", "owner@example.com");
      store.cycleSettings.get("owner")!.durationWeeks = durationWeeks;

      const active = store.bootstrap("owner").cycles.find((cycle) => cycle.status === "active");

      expect(active?.startsAt).toBe(1_700_000_000_000);
      expect(active?.endsAt).toBe(1_700_000_000_000 + durationWeeks * 7 * 24 * 60 * 60 * 1000);
    }
  });

  it("[代表値] Bootstrap時にActiveの後続Upcoming Cycleを補充する", () => {
    const { store } = setup();
    const existing = structuredClone(store.cycles.get("cycle-active"));

    const first = store.bootstrap("owner");
    const upcoming = first.cycles.filter((cycle) => cycle.status === "upcoming");

    expect(store.cycles.get("cycle-active")).toEqual(existing);
    expect(upcoming).toHaveLength(3);
    expect(upcoming.map((cycle) => cycle.number)).toEqual([2, 3, 4]);
    expect(upcoming[0].startsAt).toBe(1_701_010_800_000);
    expect(upcoming[0].startsAt).toBeGreaterThan(existing!.endsAt);
    expect(
      store.bootstrap("owner").cycles.filter((cycle) => cycle.status === "upcoming"),
    ).toHaveLength(3);
  });

  it("[状態遷移] futureCount増加時は不足分だけ補充し、減少時も既存Upcomingを保持する", () => {
    const { store, cycle } = setup();
    const first = store.bootstrap("owner");
    const existingCycles = first.cycles.map((item) => structuredClone(item));

    store.updateCycleSettings("owner", {
      idempotencyKey: "cycle-settings-future-count-up",
      durationWeeks: 2,
      startWeekday: 1,
      cooldownWeeks: 0,
      futureCount: 6,
    });
    const expanded = store.bootstrap("owner");
    const expandedUpcoming = expanded.cycles
      .filter((item) => item.status === "upcoming")
      .sort((left, right) => left.number - right.number);

    expect(expandedUpcoming).toHaveLength(6);
    expect(expandedUpcoming.map((item) => item.number)).toEqual([2, 3, 4, 5, 6, 7]);
    existingCycles.forEach((existing) => expect(store.cycles.get(existing.id)).toEqual(existing));

    store.updateCycleSettings("owner", {
      idempotencyKey: "cycle-settings-future-count-down",
      durationWeeks: 2,
      startWeekday: 1,
      cooldownWeeks: 0,
      futureCount: 1,
    });
    expect(
      store.bootstrap("owner").cycles.filter((item) => item.status === "upcoming"),
    ).toHaveLength(6);
    expect(store.cycles.get(cycle.id)).toEqual(existingCycles[0]);
  });

  it("[状態遷移] Cycle metadataを更新し、同じKeyは再利用、異なるRequestは409にする", () => {
    const { store, cycle } = setup();
    const before = {
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    };
    const updated = store.updateCycleMetadata("owner", cycle.id, {
      idempotencyKey: "cycle-meta-update-1",
      nameOverride: "集中Cycle",
      description: "今週の説明",
    });
    expect(store.activities).toHaveLength(before.activities + 1);
    expect(store.outbox).toHaveLength(before.outbox + 1);
    expect(store.receipts.size).toBe(before.receipts + 1);

    expect(updated).toMatchObject({
      id: cycle.id,
      nameOverride: "集中Cycle",
      description: "今週の説明",
    });
    const activities = store.activities.length;
    const outbox = store.outbox.length;
    const receipts = store.receipts.size;
    expect(
      store.updateCycleMetadata("owner", cycle.id, {
        idempotencyKey: "cycle-meta-update-1",
        nameOverride: "集中Cycle",
        description: "今週の説明",
      }),
    ).toEqual(updated);
    expect(store.activities).toHaveLength(activities);
    expect(store.outbox).toHaveLength(outbox);
    expect(store.receipts.size).toBe(receipts);
    expect(() =>
      store.updateCycleMetadata("owner", cycle.id, {
        idempotencyKey: "cycle-meta-update-1",
        nameOverride: "別Cycle",
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 }));
    expect(
      store.updateCycleMetadata("owner", cycle.id, {
        idempotencyKey: "cycle-meta-reset-name",
        nameOverride: null,
      }).nameOverride,
    ).toBeNull();
  });

  it("[代表値] metricsはOwner scopedでCanceledを進捗分母から除外する", () => {
    const { store, cycle, states } = setup();
    const issue = (key: string, statusId: string, estimate: 1 | 2 | 3 | 5 | 8 | null) =>
      store.createIssue("owner", {
        idempotencyKey: key,
        title: key,
        statusId,
        cycleId: cycle.id,
        estimate,
      });
    issue("cycle-metric-started", states.find((state) => state.category === "started")!.id, null);
    issue("cycle-metric-completed", states.find((state) => state.category === "completed")!.id, 2);
    issue("cycle-metric-canceled", states.find((state) => state.category === "canceled")!.id, 5);
    store.ensureOwner("other", "other@example.com");
    const foreign = store.createIssue("other", {
      idempotencyKey: "cycle-metric-foreign",
      title: "他OwnerのIssue",
    });
    foreign.cycleId = cycle.id;
    expect(() => store.getCycleMetrics("other", cycle.id)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    const metrics = store.getCycleMetrics("owner", cycle.id);
    expect(metrics).toEqual({
      total: 3,
      completed: 1,
      canceled: 1,
      progressPercent: 50,
      estimateTotal: 2,
    });
  });

  it("[状態遷移] IssueをCycleへ追加・解除するとversion CASで遷移する", () => {
    const { store, cycle, states } = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "cycle-assignment-issue",
      title: "割当対象",
      statusId: states.find((state) => state.category === "unstarted")!.id,
    });
    const assigned = store.updateIssue("owner", {
      id: issue.id,
      version: 1,
      idempotencyKey: "cycle-assignment-add",
      patch: { cycleId: cycle.id },
    });
    expect(assigned).toMatchObject({ cycleId: cycle.id, version: 2 });
    expect(() =>
      store.updateIssue("owner", {
        id: issue.id,
        version: 1,
        idempotencyKey: "cycle-assignment-stale",
        patch: { cycleId: null },
      }),
    ).toThrowError(expect.objectContaining({ code: "ISSUE_VERSION_CONFLICT", status: 409 }));
    const removed = store.updateIssue("owner", {
      id: issue.id,
      version: 2,
      idempotencyKey: "cycle-assignment-remove",
      patch: { cycleId: null },
    });
    expect(removed).toMatchObject({ cycleId: null, version: 3 });
  });

  it("[状態遷移] Upcomingの次Cycleを開始し、同じKeyは再送できる", () => {
    const { store, cycle } = setup();
    const upcoming = {
      ...cycle,
      id: "cycle-upcoming",
      number: cycle.number + 1,
      name: "Cycle 2",
      startsAt: cycle.endsAt,
      endsAt: cycle.endsAt + 7 * 24 * 60 * 60 * 1000,
      status: "upcoming" as const,
    };
    store.cycles.set(upcoming.id, upcoming);
    const future = {
      ...upcoming,
      id: "cycle-future",
      number: upcoming.number + 1,
      name: "Cycle 3",
      startsAt: upcoming.endsAt,
      endsAt: upcoming.endsAt + 7 * 24 * 60 * 60 * 1000,
    };
    store.cycles.set(future.id, future);

    const startKey = "k".repeat(200);
    const started = store.startCycle("owner", upcoming.id, startKey);
    expect(store.cycles.get(cycle.id)).toMatchObject({ status: "completed" });
    expect(started).toMatchObject({
      id: upcoming.id,
      status: "active",
      startsAt: 1_700_000_000_000,
    });
    expect(started.endsAt).toBe(
      started.startsAt + store.cycleSettings.get("owner")!.durationWeeks * 7 * 24 * 60 * 60 * 1000,
    );
    expect(store.cycles.get(future.id)).toMatchObject({
      startsAt: 1_701_615_600_000,
      endsAt: 1_702_825_200_000,
    });
    const activityCount = store.activities.length;
    const outboxCount = store.outbox.length;
    const receiptCount = store.receipts.size;

    expect(store.startCycle("owner", upcoming.id, startKey)).toEqual(started);
    expect(store.activities).toHaveLength(activityCount);
    expect(store.outbox).toHaveLength(outboxCount);
    expect(store.receipts.size).toBe(receiptCount);
  });

  it("[デシジョンテーブル] Cycle startの状態・Owner・lock境界を拒否する", () => {
    const { store, cycle } = setup();
    const upcoming = {
      ...cycle,
      id: "cycle-next-boundary",
      number: 2,
      status: "upcoming" as const,
    };
    const nonSequential = { ...upcoming, id: "cycle-non-sequential", number: 4 };
    const completed = { ...upcoming, id: "cycle-completed", status: "completed" as const };
    store.cycles.set(upcoming.id, upcoming);
    store.cycles.set(nonSequential.id, nonSequential);
    store.cycles.set(completed.id, completed);
    const beforeRejected = {
      cycles: structuredClone([...store.cycles.values()]),
      issues: structuredClone([...store.issues.values()]),
      activities: store.activities.filter((event) => event.userId === "owner").length,
      outbox: store.outbox.filter((event) => event.userId === "owner").length,
      receipts: [...store.receipts.keys()].filter((key) => key.startsWith("owner:")).length,
    };

    expect(() => store.startCycle("owner", cycle.id, "cycle-start-active")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => store.startCycle("owner", nonSequential.id, "cycle-start-gap")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => store.startCycle("owner", completed.id, "cycle-start-completed")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => store.startCycle("owner", upcoming.id, "k".repeat(201))).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect([...store.cycles.values()]).toEqual(beforeRejected.cycles);
    expect([...store.issues.values()]).toEqual(beforeRejected.issues);
    expect(store.activities.filter((event) => event.userId === "owner")).toHaveLength(
      beforeRejected.activities,
    );
    expect(store.outbox.filter((event) => event.userId === "owner")).toHaveLength(
      beforeRejected.outbox,
    );
    expect([...store.receipts.keys()].filter((key) => key.startsWith("owner:"))).toHaveLength(
      beforeRejected.receipts,
    );
    expect(() => store.startCycle("owner", "missing-cycle", "cycle-start-missing")).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    const adjusted = {
      ...upcoming,
      id: "cycle-adjusted-overlap",
      number: 3,
      scheduleOverridden: true,
      startsAt: upcoming.endsAt - 1,
      endsAt: upcoming.endsAt + 7 * 24 * 60 * 60 * 1000,
    };
    store.cycles.set(adjusted.id, adjusted);
    expect(() => store.startCycle("owner", upcoming.id, "cycle-start-overlap")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    store.ensureOwner("other", "other@example.com", true);
    expect(() => store.startCycle("other", upcoming.id, "cycle-start-owner")).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    const run = store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "cycle-start-lock",
    });
    const beforeLocked = {
      cycles: structuredClone([...store.cycles.values()]),
      issues: structuredClone([...store.issues.values()]),
      activities: store.activities.filter((event) => event.userId === "owner").length,
      outbox: store.outbox.filter((event) => event.userId === "owner").length,
      receipts: [...store.receipts.keys()].filter((key) => key.startsWith("owner:")).length,
    };
    expect(() => store.startCycle("owner", upcoming.id, "cycle-start-locked")).toThrowError(
      expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }),
    );
    expect(store.getRun("owner", run.run_id).status).toBe("running");
    expect([...store.cycles.values()]).toEqual(beforeLocked.cycles);
    expect([...store.issues.values()]).toEqual(beforeLocked.issues);
    expect(store.activities.filter((event) => event.userId === "owner")).toHaveLength(
      beforeLocked.activities,
    );
    expect(store.outbox.filter((event) => event.userId === "owner")).toHaveLength(
      beforeLocked.outbox,
    );
    expect([...store.receipts.keys()].filter((key) => key.startsWith("owner:"))).toHaveLength(
      beforeLocked.receipts,
    );

    const withoutActive = setup();
    withoutActive.store.cycles.get(withoutActive.cycle.id)!.status = "completed";
    const firstCycle = {
      ...withoutActive.cycle,
      id: "cycle-first-upcoming",
      status: "upcoming" as const,
    };
    withoutActive.store.cycles.set(firstCycle.id, firstCycle);
    expect(
      withoutActive.store.startCycle("owner", firstCycle.id, "cycle-start-no-active"),
    ).toMatchObject({
      status: "active",
      startsAt: 1_700_000_000_000,
    });
  });

  it("[セキュリティ境界] 他OwnerのCycle metadataは404で副作用がない", () => {
    const { store, cycle } = setup();
    store.ensureOwner("other", "other@example.com");
    const before = {
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
      nameOverride: cycle.nameOverride,
    };
    expect(() =>
      store.updateCycleMetadata("other", cycle.id, {
        idempotencyKey: "cycle-owner-metadata",
        nameOverride: "漏洩",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);
    expect(store.receipts.size).toBe(before.receipts);
    expect(cycle.nameOverride).toBe(before.nameOverride);
    expect(store.listCycles("other")).toEqual([]);
  });

  it("[状態遷移] Runtime lock中のmetadata更新は副作用なしで423になる", () => {
    const { store, cycle } = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "cycle-lock-issue",
      title: "Cycle lock issue",
    });
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "cycle-lock-run" });
    const before = {
      nameOverride: cycle.nameOverride,
      description: cycle.description,
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
      version: issue.version,
    };
    expect(() =>
      store.updateCycleMetadata("owner", cycle.id, {
        idempotencyKey: "cycle-lock-update",
        nameOverride: "拒否",
      }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(() =>
      store.updateIssue("owner", {
        id: issue.id,
        version: issue.version,
        idempotencyKey: "cycle-lock-assignment",
        patch: { cycleId: cycle.id },
      }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(() => store.closeCycle("owner", cycle.id, "cycle-lock-close")).toThrowError(
      expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }),
    );
    expect(cycle).toMatchObject({
      nameOverride: before.nameOverride,
      description: before.description,
    });
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);
    expect(store.receipts.size).toBe(before.receipts);
    expect(store.issues.get(issue.id)?.version).toBe(before.version);
    expect(store.getRun("owner", run.run_id).status).toBe("running");
  });
});
