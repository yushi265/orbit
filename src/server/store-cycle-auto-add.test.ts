import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

const NOW = 1_700_000_000_000;

function setup(autoAddToCurrentCycle = true) {
  const store = new OrbitStore(() => NOW);
  store.ensureOwner("owner", "owner@example.com");
  store.bootstrap("owner");
  store.updateCycleSettings("owner", {
    idempotencyKey: `auto-add-settings-${autoAddToCurrentCycle}`,
    durationWeeks: 2,
    startWeekday: 1,
    autoAddToCurrentCycle,
  });
  return store;
}

function statusId(store: OrbitStore, category: "unstarted" | "started" | "completed") {
  return store.ownedWorkflowStates("owner").find((state) => state.category === category)!.id;
}

describe("Cycle auto-add service", () => {
  it("[状態遷移] 手動Cycle割当と自動追加は繰越履歴を作成しない", () => {
    const store = setup();
    const active = store.listCycles("owner").find((cycle) => cycle.status === "active")!;
    const manual = store.createIssue("owner", {
      idempotencyKey: "auto-add-history-manual-create",
      title: "手動割当",
      statusId: statusId(store, "unstarted"),
    });
    store.updateIssue("owner", {
      id: manual.id,
      version: manual.version,
      idempotencyKey: "auto-add-history-manual-update",
      patch: { cycleId: active.id },
    });

    const automatic = store.createIssue("owner", {
      idempotencyKey: "auto-add-history-automatic-create",
      title: "自動追加",
      statusId: statusId(store, "started"),
    });

    expect(automatic.cycleId).toBe(active.id);
    expect(store.cycleHistory).toHaveLength(0);
    expect(store.getIssueDetail("owner", manual.id).carryoverCount).toBe(0);
    expect(store.getIssueDetail("owner", automatic.id).carryoverCount).toBe(0);
  });

  it("[状態遷移] 未所属IssueをStartedへ変更するとCurrent Cycleへ一度だけ自動追加する", () => {
    const store = setup();
    const active = store.listCycles("owner").find((cycle) => cycle.status === "active")!;
    const issue = store.createIssue("owner", {
      idempotencyKey: "auto-add-update-create",
      title: "自動追加対象",
      statusId: statusId(store, "unstarted"),
    });
    const initialVersion = issue.version;
    const updated = store.updateIssue("owner", {
      id: issue.id,
      version: initialVersion,
      idempotencyKey: "auto-add-update",
      patch: { statusId: statusId(store, "started") },
    });

    expect(updated).toMatchObject({ cycleId: active.id, version: 2 });
    const automation = store.activities.filter((event) => event.action === "cycle.auto_assigned");
    expect(automation).toHaveLength(1);
    expect(automation[0]).toMatchObject({
      actorType: "system:automation",
      entityType: "issue",
      entityId: issue.id,
      before: { cycleId: null, statusId: statusId(store, "unstarted") },
      after: { cycleId: active.id, statusId: statusId(store, "started") },
    });
    expect(store.outbox.filter((event) => event.type === "issue.cycle.auto_assigned")).toHaveLength(
      1,
    );

    const activityCount = store.activities.length;
    const outboxCount = store.outbox.length;
    const replay = store.updateIssue("owner", {
      id: issue.id,
      version: initialVersion,
      idempotencyKey: "auto-add-update",
      patch: { statusId: statusId(store, "started") },
    });
    expect(replay).toEqual(updated);
    expect(store.activities).toHaveLength(activityCount);
    expect(store.outbox).toHaveLength(outboxCount);
    expect(store.cycleHistory).toHaveLength(0);
  });

  it("[状態遷移] Started / Completedでの作成とbulk status変更も未所属Issueだけを自動追加する", () => {
    const store = setup();
    const active = store.listCycles("owner").find((cycle) => cycle.status === "active")!;
    const completed = store.createIssue("owner", {
      idempotencyKey: "auto-add-completed-create",
      title: "完了で作成",
      statusId: statusId(store, "completed"),
    });
    const unassigned = store.createIssue("owner", {
      idempotencyKey: "auto-add-bulk-unassigned",
      title: "一括対象",
      statusId: statusId(store, "unstarted"),
    });
    const unassignedSecond = store.createIssue("owner", {
      idempotencyKey: "auto-add-bulk-unassigned-second",
      title: "一括対象2",
      statusId: statusId(store, "unstarted"),
    });
    const assigned = store.createIssue("owner", {
      idempotencyKey: "auto-add-bulk-assigned",
      title: "一括所属済み",
      statusId: statusId(store, "unstarted"),
      cycleId: active.id,
    });

    const updated = store.bulkUpdateIssues("owner", {
      idempotencyKey: "auto-add-bulk",
      issueIds: [unassigned.id, unassignedSecond.id, assigned.id],
      patch: { statusId: statusId(store, "started") },
    });

    expect(completed.cycleId).toBe(active.id);
    expect(updated.find((issue) => issue.id === unassigned.id)).toMatchObject({
      cycleId: active.id,
      statusId: statusId(store, "started"),
    });
    expect(updated.find((issue) => issue.id === unassignedSecond.id)).toMatchObject({
      cycleId: active.id,
      statusId: statusId(store, "started"),
    });
    expect(updated.find((issue) => issue.id === assigned.id)).toMatchObject({
      cycleId: active.id,
      statusId: statusId(store, "started"),
    });
    expect(store.activities.filter((event) => event.action === "cycle.auto_assigned")).toHaveLength(
      3,
    );
    expect(store.cycleHistory).toHaveLength(0);
  });

  it("[デシジョンテーブル] 設定・Current Cycle・所属・明示cycleId・status遷移条件を守る", () => {
    const disabled = setup(false);
    const disabledIssue = disabled.createIssue("owner", {
      idempotencyKey: "auto-add-disabled-create",
      title: "OFF",
      statusId: statusId(disabled, "unstarted"),
    });
    disabled.updateIssue("owner", {
      id: disabledIssue.id,
      version: disabledIssue.version,
      idempotencyKey: "auto-add-disabled-update",
      patch: { statusId: statusId(disabled, "started") },
    });
    expect(disabled.issues.get(disabledIssue.id)?.cycleId).toBeNull();

    const noActive = setup();
    noActive.cycles.clear();
    const noActiveIssue = noActive.createIssue("owner", {
      idempotencyKey: "auto-add-no-active-create",
      title: "Cooldown中",
      statusId: statusId(noActive, "unstarted"),
    });
    noActive.updateIssue("owner", {
      id: noActiveIssue.id,
      version: noActiveIssue.version,
      idempotencyKey: "auto-add-no-active-update",
      patch: { statusId: statusId(noActive, "started") },
    });
    expect(noActive.issues.get(noActiveIssue.id)?.cycleId).toBeNull();

    const explicit = setup();
    const explicitIssue = explicit.createIssue("owner", {
      idempotencyKey: "auto-add-explicit-create",
      title: "明示解除",
      statusId: statusId(explicit, "unstarted"),
    });
    explicit.updateIssue("owner", {
      id: explicitIssue.id,
      version: explicitIssue.version,
      idempotencyKey: "auto-add-explicit-update",
      patch: { statusId: statusId(explicit, "started"), cycleId: null },
    });
    expect(explicit.issues.get(explicitIssue.id)?.cycleId).toBeNull();

    const unchanged = setup();
    const unchangedIssue = unchanged.createIssue("owner", {
      idempotencyKey: "auto-add-unchanged-create",
      title: "対象外更新",
      statusId: statusId(unchanged, "unstarted"),
    });
    unchanged.updateIssue("owner", {
      id: unchangedIssue.id,
      version: unchangedIssue.version,
      idempotencyKey: "auto-add-unchanged-update",
      patch: { title: "タイトルだけ変更" },
    });
    expect(unchanged.issues.get(unchangedIssue.id)?.cycleId).toBeNull();
  });

  it("[異常系] Runtime lock中やversion競合では自動追加と副作用を発生させない", () => {
    const store = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "auto-add-error-create",
      title: "競合対象",
      statusId: statusId(store, "unstarted"),
    });
    const before = { activities: store.activities.length, outbox: store.outbox.length };

    expect(() =>
      store.updateIssue("owner", {
        id: issue.id,
        version: 0,
        idempotencyKey: "auto-add-version-conflict",
        patch: { statusId: statusId(store, "started") },
      }),
    ).toThrowError(expect.objectContaining({ code: "ISSUE_VERSION_CONFLICT", status: 409 }));
    expect(store.issues.get(issue.id)?.cycleId).toBeNull();
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);

    store.startRun("owner", { kind: "maintenance", idempotencyKey: "auto-add-lock-run" });
    expect(() =>
      store.updateIssue("owner", {
        id: issue.id,
        version: issue.version,
        idempotencyKey: "auto-add-lock-update",
        patch: { statusId: statusId(store, "started") },
      }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(store.issues.get(issue.id)?.cycleId).toBeNull();
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);
  });

  it("[後方互換] 旧Snapshotの自動追加欠落をfalseへ補完し、未知actorを拒否する", () => {
    const store = setup(false);
    const legacy = store.toSnapshot();
    delete (legacy.cycleSettings[0] as unknown as Record<string, unknown>).autoAddToCurrentCycle;

    const restored = OrbitStore.fromSnapshot(legacy, () => NOW, "owner");
    expect(restored.cycleSettings.get("owner")?.autoAddToCurrentCycle).toBe(false);

    const invalid = store.toSnapshot();
    invalid.activities.push({
      id: "unknown-actor",
      userId: "owner",
      entityType: "issue",
      entityId: "issue",
      action: "unknown",
      actorType: "system:unknown" as never,
      mutationKey: "unknown-actor",
      before: null,
      after: null,
      createdAt: NOW,
    });
    expect(() => OrbitStore.fromSnapshot(invalid, () => NOW, "owner")).toThrow(
      "Invalid OrbitStore snapshot",
    );
  });
});
