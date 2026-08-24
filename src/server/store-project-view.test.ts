import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

const query = {
  mode: "list" as const,
  filter: {},
  showEmptyGroups: false,
  order: "manual" as const,
  layout: { priority: true },
  limit: 100,
};

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  const project = store.createProject("owner", {
    idempotencyKey: "project-store-1",
    name: "Orbit Project",
  });
  const view = store.createView("owner", {
    idempotencyKey: "view-store-1",
    name: "All Issues",
    query,
  });
  return { store, project, view };
}

describe("Project / Saved View service", () => {
  it("[境界値] Project descriptionは0..2000で更新できる", () => {
    const { store, project } = setup();
    expect(
      store.updateProject("owner", {
        id: project.id,
        idempotencyKey: "project-description-1",
        patch: { description: "あ".repeat(2_000) },
      }).description,
    ).toHaveLength(2_000);
    const beforeInvalid = {
      project: structuredClone(project),
      activities: structuredClone(store.activities),
      outbox: structuredClone(store.outbox),
      receipts: structuredClone([...store.receipts.entries()]),
    };
    expect(() =>
      store.updateProject("owner", {
        id: project.id,
        idempotencyKey: "project-description-2",
        patch: { description: "あ".repeat(2_001) },
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(project).toEqual(beforeInvalid.project);
    expect(store.activities).toEqual(beforeInvalid.activities);
    expect(store.outbox).toEqual(beforeInvalid.outbox);
    expect([...store.receipts.entries()]).toEqual(beforeInvalid.receipts);
  });

  it("[代表値] Project metricsは同一OwnerのIssueだけを集計する", () => {
    const { store, project } = setup();
    const states = store.ownedWorkflowStates("owner");
    store.createIssue("owner", {
      idempotencyKey: "project-metric-own",
      title: "Own",
      projectId: project.id,
      statusId: states.find((state) => state.category === "completed")!.id,
      estimate: 3,
    });
    store.createIssue("owner", {
      idempotencyKey: "project-metric-canceled",
      title: "Canceled",
      projectId: project.id,
      statusId: states.find((state) => state.category === "canceled")!.id,
      estimate: 5,
    });
    store.createIssue("owner", {
      idempotencyKey: "project-metric-unestimated",
      title: "Unestimated",
      projectId: project.id,
      statusId: states.find((state) => state.category === "started")!.id,
      estimate: null,
    });
    store.ensureOwner("other", "other@example.com");
    const foreign = store.createIssue("other", {
      idempotencyKey: "project-metric-foreign",
      title: "Foreign",
    });
    foreign.projectId = project.id;
    expect(store.getProjectMetrics("owner", project.id)).toEqual({
      total: 3,
      completed: 1,
      canceled: 1,
      progressPercent: 50,
      estimateTotal: 3,
    });
    expect(
      store.listIssues("owner").filter((issue) => issue.projectId === project.id),
    ).toHaveLength(3);
    expect(
      store
        .listIssues("owner")
        .filter((issue) => issue.projectId === project.id)
        .every((issue) => issue.userId === "owner"),
    ).toBe(true);
    expect(() => store.getProjectMetrics("other", project.id)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it("[状態遷移] Saved Viewを更新し、delete replayはNo-opにする", () => {
    const { store, view } = setup();
    view.layout = { legacy: true };
    view.query.layout = { current: true };
    expect(store.listViews("owner")[0].query.layout).toEqual({ legacy: true });
    expect(store.listViews("owner")[0].layout).toEqual({ legacy: true });
    const topLevelLayoutView = store.createView("owner", {
      idempotencyKey: "view-top-level-layout",
      name: "Top-level layout",
      query: { ...query, layout: {} },
      layout: { status: true },
    });
    expect(topLevelLayoutView.layout).toEqual({ status: true });
    expect(topLevelLayoutView.query.layout).toEqual({ status: true });
    store.deleteView("owner", topLevelLayoutView.id, "view-top-level-layout-delete");
    expect(
      store.createView("owner", {
        idempotencyKey: "view-store-1",
        name: "All Issues",
        query,
      }).id,
    ).toBe(view.id);
    expect(() =>
      store.createView("owner", {
        idempotencyKey: "view-store-1",
        name: "Different",
        query,
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    const updated = store.updateView("owner", view.id, {
      idempotencyKey: "view-update-1",
      name: "Started Issues",
      query: { ...query, order: "updated" },
    });
    expect(updated).toMatchObject({ name: "Started Issues", query: { order: "updated" } });
    store.updateView("owner", view.id, {
      idempotencyKey: "view-update-2",
      name: "Newest View",
    });
    const replayedUpdate = store.updateView("owner", view.id, {
      idempotencyKey: "view-update-1",
      name: "Started Issues",
      query: { ...query, order: "updated" },
    });
    expect(replayedUpdate).toMatchObject({ name: "Started Issues", query: { order: "updated" } });
    expect(store.views.get(view.id)?.name).toBe("Newest View");
    const layoutUpdated = store.updateView("owner", view.id, {
      idempotencyKey: "view-update-layout",
      layout: { status: true },
    });
    expect(layoutUpdated.layout).toEqual({ status: true });
    expect(layoutUpdated.query.layout).toEqual({ status: true });
    const queryLayoutUpdated = store.updateView("owner", view.id, {
      idempotencyKey: "view-update-query-layout",
      query: { ...query, layout: { dueAt: true } },
    });
    expect(queryLayoutUpdated.layout).toEqual({ dueAt: true });
    expect(queryLayoutUpdated.query.layout).toEqual({ dueAt: true });
    const before = { views: store.views.size, receipts: store.receipts.size };
    store.deleteView("owner", view.id, "view-delete-1");
    expect(() => store.deleteView("owner", view.id, "view-delete-1")).not.toThrow();
    expect(store.views.size).toBe(before.views - 1);
    expect(store.receipts.size).toBe(before.receipts + 1);
    expect(store.listViews("owner")).toEqual([]);
  });

  it("[セキュリティ境界] 他OwnerのProject / Viewは404で副作用がない", () => {
    const { store, project, view } = setup();
    store.ensureOwner("other", "other@example.com");
    const before = { projects: store.projects.size, views: store.views.size };
    const sideEffects = {
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    };
    expect(() =>
      store.updateProject("other", {
        id: project.id,
        idempotencyKey: "project-other-update",
        patch: { name: "漏洩" },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.updateView("other", view.id, { idempotencyKey: "view-other-update", name: "漏洩" }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => store.deleteView("other", view.id, "view-other-delete")).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(store.projects.size).toBe(before.projects);
    expect(store.views.size).toBe(before.views);
    expect(store.activities).toHaveLength(sideEffects.activities);
    expect(store.outbox).toHaveLength(sideEffects.outbox);
    expect(store.receipts.size).toBe(sideEffects.receipts);
    expect(store.listProjects("other")).toEqual([]);
    expect(store.listViews("other")).toEqual([]);
  });

  it("[状態遷移] Runtime lock中のProject / View updateは副作用なしで423になる", () => {
    const { store, project, view } = setup();
    const run = store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "project-view-lock",
    });
    const before = {
      projectName: project.name,
      viewName: view.name,
      receipts: store.receipts.size,
      projects: store.projects.size,
      views: store.views.size,
      activities: store.activities.length,
      outbox: store.outbox.length,
    };
    expect(() =>
      store.updateProject("owner", {
        id: project.id,
        idempotencyKey: "project-lock-update",
        patch: { name: "拒否" },
      }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(() =>
      store.updateView("owner", view.id, { idempotencyKey: "view-lock-update", name: "拒否" }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(project.name).toBe(before.projectName);
    expect(view.name).toBe(before.viewName);
    expect(store.receipts.size).toBe(before.receipts);
    expect(store.projects.size).toBe(before.projects);
    expect(store.views.size).toBe(before.views);
    expect(store.activities).toHaveLength(before.activities);
    expect(store.outbox).toHaveLength(before.outbox);
    expect(store.getRun("owner", run.run_id).status).toBe("running");
  });
});
