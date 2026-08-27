import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  return { store, states: store.ownedWorkflowStates("owner") };
}

describe("Phase 1 foundation store", () => {
  it("[状態遷移] Preferencesの全項目を更新し、不正timezoneを拒否する", () => {
    const { store } = setup();

    const updated = store.updatePreferences(
      "owner",
      {
        timezone: "UTC",
        locale: "en",
        theme: "dark",
        colorTheme: "ocean",
        estimateEnabled: false,
      },
      "preferences-foundation",
    );

    expect(updated).toMatchObject({
      timezone: "UTC",
      locale: "en",
      theme: "dark",
      colorTheme: "ocean",
      estimateEnabled: false,
    });
    expect(() =>
      store.updatePreferences("owner", { timezone: "Mars/Orbit" }, "preferences-invalid-timezone"),
    ).toThrowError(expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }));
    expect(store.preferences.get("owner")?.timezone).toBe("UTC");
  });

  it("[状態遷移] Workflowの追加・既定値変更・position変更をOwner scopedに行う", () => {
    const { store, states } = setup();
    const initialDefault = states.find((state) => state.isDefault)!;
    const created = store.createWorkflowState("owner", {
      idempotencyKey: "workflow-create",
      name: "Review",
      category: "started",
      color: "#123456",
    });

    expect(created).toMatchObject({
      userId: "owner",
      name: "Review",
      category: "started",
      color: "#123456",
      position: 5,
      isDefault: false,
    });

    const updated = store.updateWorkflowState("owner", created.id, {
      idempotencyKey: "workflow-promote",
      name: "Review now",
      color: "#ABCDEF",
      position: 0,
      isDefault: true,
    });
    expect(updated).toMatchObject({ name: "Review now", color: "#ABCDEF", position: 0 });
    expect(store.ownedWorkflowStates("owner")[0].id).toBe(created.id);
    expect(store.ownedWorkflowStates("owner").filter((state) => state.isDefault)).toHaveLength(1);
    expect(initialDefault.isDefault).toBe(false);
    expect(store.ownedWorkflowStates("owner").map((state) => state.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    const replay = store.updateWorkflowState("owner", created.id, {
      idempotencyKey: "workflow-promote",
      name: "Review now",
      color: "#ABCDEF",
      position: 0,
      isDefault: true,
    });
    expect(replay).toEqual(updated);
    expect(() =>
      store.updateWorkflowState("owner", created.id, {
        idempotencyKey: "workflow-promote",
        name: "different",
      }),
    ).toThrowError(expect.objectContaining({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" }));
    expect(() =>
      store.updateWorkflowState("other", created.id, {
        idempotencyKey: "workflow-foreign",
        name: "Foreign",
      }),
    ).toThrowError(expect.objectContaining({ status: 404, code: "RESOURCE_NOT_FOUND" }));
  });

  it("[異常系] Workflow更新の入力エラーは部分変更を残さない", () => {
    const { store, states } = setup();
    const state = states[0];
    const before = { name: state.name, color: state.color };

    expect(() =>
      store.updateWorkflowState("owner", state.id, {
        idempotencyKey: "workflow-invalid-partial",
        name: "Renamed before failure",
        color: "invalid",
      }),
    ).toThrowError(expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }));
    expect(state).toMatchObject(before);
  });

  it("[状態遷移/禁止] 既定またはIssue参照中のWorkflow削除を拒否する", () => {
    const { store, states } = setup();
    const defaultState = states.find((state) => state.isDefault)!;
    const referenced = store.createWorkflowState("owner", {
      idempotencyKey: "workflow-referenced-create",
      name: "Referenced",
      category: "started",
      color: "#654321",
    });
    store.createIssue("owner", {
      idempotencyKey: "workflow-referenced-issue",
      title: "Referenced state",
      statusId: referenced.id,
    });
    const before = {
      workflowStates: store.ownedWorkflowStates("owner").length,
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    };

    expect(() =>
      store.deleteWorkflowState("owner", defaultState.id, "workflow-delete-default"),
    ).toThrowError(expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }));
    expect(() =>
      store.deleteWorkflowState("owner", referenced.id, "workflow-delete-referenced"),
    ).toThrowError(expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }));
    expect(store.ownedWorkflowStates("owner")).toHaveLength(before.workflowStates);
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);
    expect(store.receipts.size).toBe(before.receipts);
  });

  it("[デシジョンテーブル] Background lock中はPreferencesとWorkflowを423で拒否する", () => {
    const { store } = setup();
    store.startRun("owner", { kind: "maintenance", idempotencyKey: "foundation-run" });
    const before = store.toSnapshot();

    expect(() =>
      store.updatePreferences("owner", { theme: "dark" }, "locked-preferences"),
    ).toThrowError(expect.objectContaining({ status: 423, code: "OPERATION_IN_PROGRESS" }));
    expect(() =>
      store.createWorkflowState("owner", {
        idempotencyKey: "locked-workflow",
        name: "Blocked",
        category: "started",
        color: "#112233",
      }),
    ).toThrowError(expect.objectContaining({ status: 423, code: "OPERATION_IN_PROGRESS" }));

    const after = store.toSnapshot();
    expect(after.preferences).toEqual(before.preferences);
    expect(after.workflowStates).toEqual(before.workflowStates);
    expect(after.activities).toEqual(before.activities);
    expect(after.outbox).toEqual(before.outbox);
    expect(after.receipts).toEqual(before.receipts);
  });

  it("[セキュリティ境界] Public Run summaryから内部Tokenと所有者情報を除外する", () => {
    const { store } = setup();
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "public-run" });
    const summary = store.publicRun(run) as Record<string, unknown>;

    expect(summary).not.toHaveProperty("user_id");
    expect(summary).not.toHaveProperty("idempotencyKey");
    expect(summary).not.toHaveProperty("requestHash");
    expect(summary).not.toHaveProperty("leaseExpiresAt");
    expect(summary).not.toHaveProperty("stepStatuses");
    expect(JSON.stringify(summary)).not.toContain("lock");
    expect(JSON.stringify(summary)).not.toContain("admission");
  });

  it("[状態遷移] pending Runはlock情報が欠けていても業務Mutationを拒否する", () => {
    const { store } = setup();
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "pending-run" });
    run.status = "pending";
    const lock = store.locks.get("owner")!;
    lock.status = "idle";
    lock.runId = null;
    lock.token = null;
    const before = store.toSnapshot();

    expect(() =>
      store.updatePreferences("owner", { theme: "dark" }, "pending-preferences"),
    ).toThrowError(expect.objectContaining({ status: 423, code: "OPERATION_IN_PROGRESS" }));
    expect(store.toSnapshot()).toEqual(before);
  });

  it("[状態遷移/禁止] pending Run中に別のRunを開始してlockを上書きしない", () => {
    const { store } = setup();
    const pending = store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "pending-admission",
    });
    pending.status = "pending";
    const lock = store.locks.get("owner")!;
    lock.status = "idle";
    lock.runId = null;
    lock.token = null;
    lock.leaseExpiresAt = null;

    expect(() =>
      store.startRun("owner", { kind: "maintenance", idempotencyKey: "second-admission" }),
    ).toThrowError(expect.objectContaining({ status: 423, code: "OPERATION_IN_PROGRESS" }));
    expect([...store.runs.values()].filter((run) => run.status === "running")).toHaveLength(0);
    expect(store.locks.get("owner")?.runId).toBeNull();
  });
});
