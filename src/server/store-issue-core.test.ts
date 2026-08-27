import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

function setup() {
  let now = 1_700_000_000_000;
  const store = new OrbitStore(() => now);
  store.ensureOwner("owner", "owner@example.com");
  return {
    store,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function stateId(store: OrbitStore, category: "unstarted" | "completed" | "canceled") {
  return store.ownedWorkflowStates("owner").find((state) => state.category === category)!.id;
}

describe("Phase 2 Issue core data", () => {
  it("[状態遷移] parent / children / childProgressをdirect childrenから算出する", () => {
    const { store } = setup();
    const parent = store.createIssue("owner", {
      idempotencyKey: "phase2-parent",
      title: "親Issue",
    });
    const completed = store.createIssue("owner", {
      idempotencyKey: "phase2-child-completed",
      title: "完了Sub issue",
      parentId: parent.id,
      statusId: stateId(store, "completed"),
    });
    const canceled = store.createIssue("owner", {
      idempotencyKey: "phase2-child-canceled",
      title: "取消Sub issue",
      parentId: parent.id,
      statusId: stateId(store, "canceled"),
    });

    const detail = store.getIssueDetail("owner", completed.id);
    expect(detail.parent).toMatchObject({ id: parent.id, identifier: parent.identifier });
    expect(detail.children).toEqual([]);

    const parentDetail = store.getIssueDetail("owner", parent.id);
    expect(parentDetail.children.map((child) => child.id)).toEqual([completed.id, canceled.id]);
    expect(parentDetail.childProgress).toEqual({
      total: 2,
      completed: 1,
      canceled: 1,
      progressPercent: 100,
    });
  });

  it("[デシジョンテーブル] parentのOwner /存在 / self / descendantを検証する", () => {
    const { store } = setup();
    const parent = store.createIssue("owner", {
      idempotencyKey: "test-cycle-parent",
      title: "親",
    });
    const child = store.createIssue("owner", {
      idempotencyKey: "phase2-cycle-child",
      title: "子",
      parentId: parent.id,
    });

    expect(() =>
      store.createIssue("owner", {
        idempotencyKey: "test-parent-missing",
        title: "欠落親",
        parentId: "missing-parent",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.updateIssue("owner", {
        id: parent.id,
        version: parent.version,
        idempotencyKey: "phase2-parent-self",
        patch: { parentId: parent.id },
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      store.updateIssue("owner", {
        id: parent.id,
        version: parent.version,
        idempotencyKey: "phase2-parent-descendant",
        patch: { parentId: child.id },
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    store.ensureOwner("other", "other@example.com");
    const other = store.createIssue("other", {
      idempotencyKey: "test-foreign-parent",
      title: "他Ownerの親",
    });
    expect(() =>
      store.updateIssue("owner", {
        id: child.id,
        version: child.version,
        idempotencyKey: "test-parent-foreign",
        patch: { parentId: other.id },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("[同値分割 + 境界値] Estimate / Due dateを保存し、不正値を副作用なしで拒否する", () => {
    const { store } = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "phase2-attributes-create",
      title: "属性Issue",
    });
    const updated = store.updateIssue("owner", {
      id: issue.id,
      version: issue.version,
      idempotencyKey: "phase2-attributes-update",
      patch: { estimate: 8, dueAt: 1_700_000_100_000 },
    });
    expect(updated).toMatchObject({ estimate: 8, dueAt: 1_700_000_100_000, version: 2 });
    expect(() =>
      store.updateIssue("owner", {
        id: issue.id,
        version: updated.version,
        idempotencyKey: "test-invalid-estimate",
        patch: { estimate: 4 as never },
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(store.issues.get(issue.id)).toMatchObject({ estimate: 8, version: 2 });
  });

  it("[デシジョンテーブル] active / archived / trash scopeを分離する", () => {
    const { store } = setup();
    const active = store.createIssue("owner", {
      idempotencyKey: "phase2-scope-active",
      title: "Active",
    });
    const archived = store.createIssue("owner", {
      idempotencyKey: "phase2-scope-archived",
      title: "Archived",
    });
    const trashed = store.createIssue("owner", {
      idempotencyKey: "phase2-scope-trash",
      title: "Trash",
    });
    store.archiveIssue("owner", archived.id, "phase2-scope-archive");
    store.trashIssue("owner", trashed.id, "phase2-scope-trash-action");

    expect(store.listIssues("owner", {}, "active").map((item) => item.id)).toContain(active.id);
    expect(store.listIssues("owner", {}, "active").map((item) => item.id)).not.toContain(
      archived.id,
    );
    expect(store.listIssues("owner", {}, "archived").map((item) => item.id)).toEqual([archived.id]);
    expect(store.listIssues("owner", {}, "trash").map((item) => item.id)).toEqual([trashed.id]);
  });

  it("[状態遷移] Recent issue / searchをupsertし、各20件へtrimしてSnapshot往復する", () => {
    const { store, advance } = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "phase2-recent-issue",
      title: "Recent issue",
    });
    store.recordRecentIssueView("owner", issue.id, "phase2-recent-view-1");
    advance(10);
    store.recordRecentIssueView("owner", issue.id, "phase2-recent-view-2");
    expect(store.listRecent("owner").issueViews).toHaveLength(1);
    expect(store.listRecent("owner").issueViews[0]).toMatchObject({
      issueId: issue.id,
      viewedAt: 1_700_000_000_010,
    });

    for (let index = 0; index < 21; index += 1) {
      store.recordRecentSearch(
        "owner",
        { text: `query-${index}`, filter: {} },
        `phase2-recent-search-${index}`,
      );
      advance(1);
    }
    const recent = store.listRecent("owner");
    expect(recent.searches).toHaveLength(20);
    expect(recent.searches[0].query.text).toBe("query-20");

    const restored = OrbitStore.fromSnapshot(store.toSnapshot(), () => 1_700_000_000_000, "owner");
    expect(restored.listRecent("owner")).toEqual(recent);
  });
});
