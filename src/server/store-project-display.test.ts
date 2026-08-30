import { describe, expect, it } from "vitest";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  const project = store.createProject("owner", {
    idempotencyKey: "display-project",
    name: "Project",
  });
  return { store, project };
}

describe("Project display preferences store", () => {
  it("[代表値] 未保存時は初期値を返し、更新後はBootstrapへ投影する", () => {
    const { store, project } = setup();
    expect(store.getProjectDisplayPreferences("owner", project.id).settings).toEqual(
      defaultProjectIssueDisplaySettings(),
    );
    expect(store.projectDisplayPreferences).toHaveLength(0);
    const before = {
      projects: structuredClone(store.projects),
      issues: structuredClone(store.issues),
      activities: structuredClone(store.activities),
      outbox: structuredClone(store.outbox),
    };

    const updated = store.updateProjectDisplayPreferences("owner", project.id, {
      idempotencyKey: "display-update-1",
      displayPreferences: {
        ...defaultProjectIssueDisplaySettings(),
        mode: "board",
        showCompleted: false,
      },
    });

    expect(updated.settings).toMatchObject({ mode: "board", showCompleted: false });
    expect(store.getProjectDisplayPreferences("owner", project.id)).toEqual(updated);
    expect(store.listProjectDisplayPreferences("owner")).toEqual([updated]);
    expect(store.bootstrap("owner").projectDisplayPreferences).toEqual([updated]);
    expect(store.projects).toEqual(before.projects);
    expect(store.issues).toEqual(before.issues);
    expect(store.activities).toEqual(before.activities);
    expect(store.outbox).toEqual(before.outbox);
  });

  it("[状態遷移] Snapshotを往復して別Sessionでも表示設定を復元する", () => {
    const { store, project } = setup();
    store.updateProjectDisplayPreferences("owner", project.id, {
      idempotencyKey: "display-update-roundtrip",
      displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "due_asc" },
    });

    const restored = OrbitStore.fromSnapshot(
      JSON.parse(JSON.stringify(store.toSnapshot())),
      () => 1_700_000_000_001,
      "owner",
    );

    expect(restored.getProjectDisplayPreferences("owner", project.id).settings.order).toBe(
      "due_asc",
    );
    expect(restored.bootstrap("owner").projectDisplayPreferences).toEqual(
      store.bootstrap("owner").projectDisplayPreferences,
    );
  });

  it("[境界値] 旧SnapshotでProject表示設定配列が欠落していても初期値へ補完する", () => {
    const { store, project } = setup();
    const legacy = JSON.parse(JSON.stringify(store.toSnapshot())) as Record<string, unknown>;
    delete legacy.projectDisplayPreferences;

    const restored = OrbitStore.fromSnapshot(legacy, () => 1_700_000_000_001, "owner");

    expect(restored.getProjectDisplayPreferences("owner", project.id).settings).toEqual(
      defaultProjectIssueDisplaySettings(),
    );
    expect(restored.bootstrap("owner").projectDisplayPreferences).toEqual([]);
  });

  it("[セキュリティ境界] Bootstrapは本人のProject表示設定だけを返す", () => {
    const { store, project } = setup();
    store.updateProjectDisplayPreferences("owner", project.id, {
      idempotencyKey: "display-owner-only",
      displayPreferences: defaultProjectIssueDisplaySettings(),
    });
    store.ensureOwner("other", "other@example.com");
    store.projectDisplayPreferences.set("foreign-display", {
      id: "foreign-display",
      userId: "other",
      projectId: project.id,
      settings: defaultProjectIssueDisplaySettings(),
      updatedAt: 1_700_000_000_001,
    });

    const preferences = store.bootstrap("owner").projectDisplayPreferences;
    expect(preferences).toHaveLength(1);
    expect(preferences[0].userId).toBe("owner");
  });

  it("[整合性] Snapshot内の同一Owner・Project重複recordを拒否する", () => {
    const { store, project } = setup();
    store.updateProjectDisplayPreferences("owner", project.id, {
      idempotencyKey: "display-duplicate-source",
      displayPreferences: defaultProjectIssueDisplaySettings(),
    });
    const snapshot = store.toSnapshot();
    snapshot.projectDisplayPreferences.push({
      ...snapshot.projectDisplayPreferences[0],
      id: "duplicate-display",
      settings: { ...defaultProjectIssueDisplaySettings(), mode: "board" },
    });

    expect(() => OrbitStore.fromSnapshot(snapshot, undefined, "owner")).toThrow(
      "Invalid OrbitStore snapshot",
    );
  });

  it("[セキュリティ境界] Owner指定Snapshotに別Ownerの表示設定を混在させない", () => {
    const { store, project } = setup();
    store.updateProjectDisplayPreferences("owner", project.id, {
      idempotencyKey: "display-owner-snapshot",
      displayPreferences: defaultProjectIssueDisplaySettings(),
    });
    const snapshot = store.toSnapshot();
    snapshot.projectDisplayPreferences[0].userId = "other";

    expect(() => OrbitStore.fromSnapshot(snapshot, undefined, "owner")).toThrow(
      "Invalid OrbitStore snapshot",
    );
  });

  it("[デシジョンテーブル] Owner外・同一Key再送・異なるRequest・lockを分岐する", () => {
    const { store, project } = setup();
    store.ensureOwner("other", "other@example.com");
    const input = {
      idempotencyKey: "display-boundary",
      displayPreferences: defaultProjectIssueDisplaySettings(),
    };
    expect(() => store.getProjectDisplayPreferences("other", project.id)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    const foreignState = store.ownedWorkflowStates("other")[0];
    expect(() =>
      store.updateProjectDisplayPreferences("owner", project.id, {
        idempotencyKey: "display-foreign-status",
        displayPreferences: {
          ...defaultProjectIssueDisplaySettings(),
          statusFilter: foreignState.id,
        },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.updateProjectDisplayPreferences("owner", project.id, {
        idempotencyKey: "display-missing-label",
        displayPreferences: {
          ...defaultProjectIssueDisplaySettings(),
          labelFilter: "missing-label",
        },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    const first = store.updateProjectDisplayPreferences("owner", project.id, input);
    expect(store.updateProjectDisplayPreferences("owner", project.id, input)).toEqual(first);
    const beforeConflict = structuredClone(store.projectDisplayPreferences);
    expect(() =>
      store.updateProjectDisplayPreferences("owner", project.id, {
        ...input,
        displayPreferences: { ...input.displayPreferences, mode: "board" },
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    expect(store.projectDisplayPreferences).toEqual(beforeConflict);

    store.startRun("owner", { kind: "maintenance", idempotencyKey: "display-lock" });
    expect(() =>
      store.updateProjectDisplayPreferences("owner", project.id, {
        idempotencyKey: "display-locked",
        displayPreferences: defaultProjectIssueDisplaySettings(),
      }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(store.projectDisplayPreferences).toEqual(beforeConflict);
  });

  it("[代表値] Project scopeの手動並び替えは同じProject内だけを並べ替える", () => {
    const { store, project } = setup();
    const states = store.ownedWorkflowStates("owner");
    const first = store.createIssue("owner", {
      idempotencyKey: "display-reorder-first",
      title: "first",
      projectId: project.id,
      statusId: states[1].id,
    });
    const second = store.createIssue("owner", {
      idempotencyKey: "display-reorder-second",
      title: "second",
      projectId: project.id,
      statusId: states[1].id,
    });
    const outside = store.createIssue("owner", {
      idempotencyKey: "display-reorder-outside",
      title: "outside",
      statusId: states[1].id,
    });
    const outsidePosition = outside.position;

    store.reorderIssue("owner", {
      idempotencyKey: "display-reorder-move",
      issueId: second.id,
      version: second.version,
      beforeIssueId: first.id,
      projectId: project.id,
    });

    const projectOrder = store
      .listIssues("owner")
      .filter((issue) => issue.projectId === project.id)
      .sort((left, right) => left.position - right.position)
      .map((issue) => issue.id);
    expect(projectOrder).toEqual([second.id, first.id]);
    expect(store.issues.get(outside.id)?.position).toBe(outsidePosition);
  });

  it("[同値分割] 不存在または削除済みProjectは表示設定を保存できない", () => {
    const { store } = setup();
    const settings = {
      idempotencyKey: "display-missing-project",
      displayPreferences: defaultProjectIssueDisplaySettings(),
    };
    expect(() => store.getProjectDisplayPreferences("owner", "missing-project")).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(() =>
      store.updateProjectDisplayPreferences("owner", "missing-project", settings),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    const deleted = store.createProject("owner", {
      idempotencyKey: "display-deleted-project",
      name: "Deleted Project",
    });
    deleted.deletedAt = 1_700_000_000_001;
    expect(() =>
      store.updateProjectDisplayPreferences("owner", deleted.id, {
        ...settings,
        idempotencyKey: "display-deleted-project-update",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => store.getProjectDisplayPreferences("owner", deleted.id)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});
