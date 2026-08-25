import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

describe("OrbitStore snapshot persistence", () => {
  it("round-trips bootstrap data and background state", () => {
    const store = new OrbitStore(() => 1_700_000_000_000);
    store.ensureOwner("owner-1", "owner@example.com");
    const workflowState = store.ownedWorkflowStates("owner-1")[1];
    const projectStatus = store.ownedProjectStatuses("owner-1")[1];

    const project = store.createProject("owner-1", {
      idempotencyKey: "project-1",
      name: "Persisted project",
      statusId: projectStatus.id,
    });
    store.createLabel("owner-1", {
      idempotencyKey: "label-1",
      name: "release",
      color: "#123456",
    });
    const issue = store.createIssue("owner-1", {
      idempotencyKey: "issue-1",
      title: "Persisted issue",
      statusId: workflowState.id,
      projectId: project.id,
    });
    const relatedIssue = store.createIssue("owner-1", {
      idempotencyKey: "issue-2",
      title: "Related issue",
      statusId: workflowState.id,
    });
    store.reorderIssue("owner-1", {
      idempotencyKey: "reorder-persist-1",
      issueId: relatedIssue.id,
      version: relatedIssue.version,
      beforeIssueId: issue.id,
    });
    store.createIssueNote("owner-1", issue.id, {
      idempotencyKey: "note-1",
      body: "Persisted note",
    });
    store.createIssueRelation("owner-1", issue.id, {
      idempotencyKey: "relation-1",
      targetIssueId: relatedIssue.id,
      type: "related",
    });
    store.createView("owner-1", {
      idempotencyKey: "view-1",
      name: "Persisted view",
      query: {
        mode: "list",
        filter: {},
        showEmptyGroups: false,
        order: "manual",
        layout: { status: true },
        limit: 100,
      },
    });
    store.notifications.set("notification-1", {
      id: "notification-1",
      userId: "owner-1",
      type: "due_soon",
      title: "Persisted notification",
      body: "Open the issue",
      entityType: "issue",
      entityId: "issue-1",
      readAt: null,
      deletedAt: null,
      createdAt: 1_700_000_000_000,
    });
    store.cycleHistory.push({
      id: "history-1",
      userId: "owner-1",
      issueId: "issue-1",
      fromCycleId: "cycle-before",
      toCycleId: "cycle-after",
      movedAt: 1_700_000_000_000,
    });
    store.startRun("owner-1", { kind: "maintenance", idempotencyKey: "run-1" });

    const restored = OrbitStore.fromSnapshot(
      JSON.parse(JSON.stringify(store.toSnapshot())),
      () => 1_700_000_000_001,
      "owner-1",
    );

    expect(restored.bootstrap("owner-1")).toEqual(store.bootstrap("owner-1"));
    expect(restored.currentRun("owner-1")).toEqual(store.currentRun("owner-1"));
    expect(restored.cycleHistory).toEqual(store.cycleHistory);
    expect(restored.notes.size).toBe(store.notes.size);
    expect(restored.relations.size).toBe(store.relations.size);
    expect(restored.notifications.get("notification-1")).toMatchObject({
      title: "Persisted notification",
      body: "Open the issue",
    });
    expect(restored.receipts.size).toBe(store.receipts.size);
    expect(restored.activities.length).toBe(store.activities.length);
    expect(restored.outbox.length).toBe(store.outbox.length);
    expect(restored.toSnapshot()).toEqual(store.toSnapshot());
  });

  it("round-trips an empty store without inventing an owner", () => {
    const snapshot = new OrbitStore().toSnapshot();
    const restored = OrbitStore.fromSnapshot(snapshot);

    expect(restored.toSnapshot()).toEqual(snapshot);
    expect(restored.users.size).toBe(0);
  });

  it("[状態遷移] 旧SnapshotでcolorThemeが欠落していてもCoralを補完する", () => {
    const store = new OrbitStore(() => 1_700_000_000_000);
    store.ensureOwner("owner-legacy", "legacy@example.com");
    const legacy = JSON.parse(JSON.stringify(store.toSnapshot())) as {
      preferences: Array<Record<string, unknown>>;
    };
    delete legacy.preferences[0].colorTheme;

    const restored = OrbitStore.fromSnapshot(legacy, () => 1_700_000_000_001, "owner-legacy");

    expect(restored.bootstrap("owner-legacy").preferences.colorTheme).toBe("coral");
  });

  it("[境界値] 不正なcolorThemeを含むSnapshotは復元を拒否する", () => {
    const store = new OrbitStore(() => 1_700_000_000_000);
    store.ensureOwner("owner-invalid-theme", "invalid-theme@example.com");
    const invalid = JSON.parse(JSON.stringify(store.toSnapshot())) as {
      preferences: Array<Record<string, unknown>>;
    };
    invalid.preferences[0].colorTheme = "sepia";

    expect(() => OrbitStore.fromSnapshot(invalid, undefined, "owner-invalid-theme")).toThrow(
      "Invalid OrbitStore snapshot",
    );
  });

  it("[代表値] Coral以外のcolorThemeもSnapshotへ保存・復元できる", () => {
    const store = new OrbitStore(() => 1_700_000_000_000);
    store.ensureOwner("owner-ocean", "ocean@example.com");
    store.updatePreferences("owner-ocean", { colorTheme: "ocean" }, "theme-ocean");

    const restored = OrbitStore.fromSnapshot(
      JSON.parse(JSON.stringify(store.toSnapshot())),
      undefined,
      "owner-ocean",
    );

    expect(restored.bootstrap("owner-ocean").preferences.colorTheme).toBe("ocean");
  });

  it("rejects a malformed snapshot without creating partial state", () => {
    expect(() => OrbitStore.fromSnapshot({ users: [] } as never)).toThrow(
      "Invalid OrbitStore snapshot",
    );
  });

  it("rejects a snapshot that contains another owner's record", () => {
    const store = new OrbitStore();
    store.ensureOwner("owner-1", "owner@example.com");
    const snapshot = store.toSnapshot();
    snapshot.preferences.push({
      ...snapshot.preferences[0],
      userId: "owner-2",
    });

    expect(() => OrbitStore.fromSnapshot(snapshot, undefined, "owner-1")).toThrow(
      "Invalid OrbitStore snapshot",
    );
  });
});
