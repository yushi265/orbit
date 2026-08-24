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
