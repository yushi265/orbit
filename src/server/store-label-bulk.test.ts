import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com", true);
  const states = store.ownedWorkflowStates("owner");
  const project = store.createProject("owner", {
    idempotencyKey: "label-bulk-project",
    name: "Bulk Project",
  });
  const cycle = store.listCycles("owner")[0];
  const label = store.createLabel("owner", {
    idempotencyKey: "label-create-1",
    name: "Bug",
    color: "#E05252",
  });
  const issues = ["One", "Two"].map((title, index) =>
    store.createIssue("owner", {
      idempotencyKey: `label-bulk-issue-${index}`,
      title,
      statusId: states.find((state) => state.category === "unstarted")!.id,
      projectId: project.id,
      cycleId: cycle.id,
      labelIds: [label.id],
    }),
  );
  return { store, states, project, cycle, label, issues };
}

describe("Label / Issue Bulk service", () => {
  it("[状態遷移] Label CRUDはIssue参照を同期し、同じKeyを再利用する", () => {
    const { store, label, issues } = setup();
    expect(store.listLabels("owner")).toEqual([label]);
    expect(store.bootstrap("owner").labels).toEqual([label]);
    const replayed = store.createLabel("owner", {
      idempotencyKey: "label-create-1",
      name: "Bug",
      color: "#E05252",
    });
    expect(replayed.id).toBe(label.id);
    expect(() =>
      store.createLabel("owner", {
        idempotencyKey: "label-create-1",
        name: "Different",
        color: "#000000",
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    const updated = store.updateLabel("owner", label.id, {
      idempotencyKey: "label-update-1",
      name: "Defect",
      color: "#AA1122",
    });
    expect(updated).toMatchObject({ name: "Defect", color: "#AA1122" });
    expect(
      store.activities.some((event) => event.entityType === "label" && event.action === "updated"),
    ).toBe(true);
    expect(store.outbox.some((event) => event.type === "label.updated")).toBe(true);
    expect(store.receipts.get("owner:label-update-1")).toMatchObject({ operation: "label.update" });
    expect(
      store.updateLabel("owner", label.id, {
        idempotencyKey: "label-update-1",
        name: "Defect",
        color: "#AA1122",
      }).id,
    ).toBe(label.id);
    expect(() =>
      store.updateLabel("owner", label.id, {
        idempotencyKey: "label-update-1",
        name: "Conflict",
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    store.deleteLabel("owner", label.id, "label-delete-1");
    expect(store.listLabels("owner")).toEqual([]);
    expect(issues.every((issue) => issue.labelIds.length === 0)).toBe(true);
    expect(() => store.deleteLabel("owner", label.id, "label-delete-1")).not.toThrow();
    store.ensureOwner("other", "other@example.com");
    expect(store.listLabels("other")).toEqual([]);
    expect(() =>
      store.updateLabel("other", label.id, { idempotencyKey: "label-other-update", name: "Leak" }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("[状態遷移] Bulkは各対象を一括更新し、versionを進める", () => {
    const { store, states, cycle, label, issues } = setup();
    const beforeVersions = issues.map((issue) => issue.version);
    const priorityUpdated = store.bulkUpdateIssues("owner", {
      idempotencyKey: "bulk1",
      issueIds: [issues[0].id, issues[1].id, issues[0].id],
      patch: { priority: "urgent" },
    });
    expect(priorityUpdated.map((issue) => issue.priority)).toEqual(["urgent", "urgent"]);
    expect(issues.map((issue) => issue.version)).toEqual(
      beforeVersions.map((version) => version + 1),
    );
    expect(store.activities.filter((event) => event.action === "bulk_updated")).toHaveLength(2);
    expect(store.outbox.filter((event) => event.type === "issue.bulk_updated")).toHaveLength(2);
    expect(store.receipts.get("owner:bulk1")).toMatchObject({
      operation: "issue.bulk",
    });
    const status = states.find((item) => item.category === "completed")!;
    expect(
      store
        .bulkUpdateIssues("owner", {
          idempotencyKey: "bulk-status-1",
          issueIds: issues.map((issue) => issue.id),
          patch: { statusId: status.id },
        })
        .every((issue) => issue.statusId === status.id),
    ).toBe(true);
    expect(
      store
        .bulkUpdateIssues("owner", {
          idempotencyKey: "bulk-project-1",
          issueIds: issues.map((issue) => issue.id),
          patch: { projectId: null },
        })
        .every((issue) => issue.projectId === null),
    ).toBe(true);
    expect(
      store
        .bulkUpdateIssues("owner", {
          idempotencyKey: "bulk-cycle-1",
          issueIds: issues.map((issue) => issue.id),
          patch: { cycleId: cycle.id },
        })
        .every((issue) => issue.cycleId === cycle.id),
    ).toBe(true);
    expect(
      store
        .bulkUpdateIssues("owner", {
          idempotencyKey: "bulk-label-1",
          issueIds: issues.map((issue) => issue.id),
          patch: { labelIds: [label.id] },
        })
        .every((issue) => issue.labelIds[0] === label.id),
    ).toBe(true);
  });

  it("[異常系] Bulkの参照エラーは全件不変で、Owner外は404になる", () => {
    const { store, issues } = setup();
    store.ensureOwner("other", "other@example.com");
    const foreignLabel = store.createLabel("other", {
      idempotencyKey: "foreign-label",
      name: "Foreign",
      color: "#111111",
    });
    const before = {
      issues: structuredClone(issues),
      activities: structuredClone(store.activities),
      outbox: structuredClone(store.outbox),
      receipts: structuredClone([...store.receipts.entries()]),
    };
    expect(() =>
      store.bulkUpdateIssues("owner", {
        idempotencyKey: "bulk-invalid-target",
        issueIds: [issues[0].id, "missing-issue"],
        patch: { priority: "low" },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(issues).toEqual(before.issues);
    expect(store.activities).toEqual(before.activities);
    expect(store.outbox).toEqual(before.outbox);
    expect([...store.receipts.entries()]).toEqual(before.receipts);
    expect(() =>
      store.bulkUpdateIssues("owner", {
        idempotencyKey: "bulk-foreign-label",
        issueIds: [issues[0].id],
        patch: { labelIds: [foreignLabel.id] },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("[状態遷移] Bulkのsame-key replayとRuntime lockは副作用を増やさない", () => {
    const { store, issues } = setup();
    const input = {
      idempotencyKey: "bulk-replay-1",
      issueIds: issues.map((issue) => issue.id),
      patch: { priority: "low" as const },
    };
    const first = store.bulkUpdateIssues("owner", input);
    const beforeReplay = {
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    };
    const replayed = store.bulkUpdateIssues("owner", input);
    expect(replayed).toEqual(first);
    expect(store.activities).toHaveLength(beforeReplay.activities);
    expect(store.outbox).toHaveLength(beforeReplay.outbox);
    expect(store.receipts.size).toBe(beforeReplay.receipts);
    const run = store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "bulk-lock-run",
    });
    const lockedBefore = structuredClone(issues);
    expect(() =>
      store.bulkUpdateIssues("owner", {
        idempotencyKey: "bulk-locked",
        issueIds: issues.map((issue) => issue.id),
        patch: { priority: "urgent" },
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(issues).toEqual(lockedBefore);
    expect(store.getRun("owner", run.run_id).status).toBe("running");
  });

  it("[セキュリティ境界] Label / Status / Project / CycleはOwner外参照を拒否する", () => {
    const { store, issues } = setup();
    store.ensureOwner("other", "other@example.com", true);
    const foreignLabel = store.createLabel("other", {
      idempotencyKey: "foreign-reference-label",
      name: "Other",
      color: "#999999",
    });
    const foreignStatus = store.ownedWorkflowStates("other")[0];
    const foreignProject = store.listProjects("other")[0];
    const foreignCycle = store.listCycles("other")[0];
    expect(() =>
      store.createIssue("owner", {
        idempotencyKey: "foreign-create-label",
        title: "拒否",
        labelIds: [foreignLabel.id],
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.updateIssue("owner", {
        id: issues[0].id,
        version: issues[0].version,
        idempotencyKey: "foreign-update-label",
        patch: { labelIds: [foreignLabel.id] },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    const references = [
      { statusId: foreignStatus.id },
      { projectId: foreignProject.id },
      { cycleId: foreignCycle.id },
      { labelIds: [foreignLabel.id] },
    ];
    references.forEach((patch, index) => {
      expect(() =>
        store.bulkUpdateIssues("owner", {
          idempotencyKey: `foreign-bulk-${index}`,
          issueIds: [issues[0].id],
          patch,
        }),
      ).toThrowError(expect.objectContaining({ status: 404 }));
    });
  });

  it("[障害注入] Bulkの適用途中で例外が出ても全件rollbackする", () => {
    const { store, issues } = setup();
    const before = {
      issues: structuredClone(issues),
      activities: structuredClone(store.activities),
      outbox: structuredClone(store.outbox),
      receipts: structuredClone([...store.receipts.entries()]),
    };
    const internals = store as unknown as {
      recordOutbox: (...args: unknown[]) => void;
    };
    const originalRecordOutbox = internals.recordOutbox;
    let outboxCalls = 0;
    internals.recordOutbox = () => {
      outboxCalls += 1;
      if (outboxCalls === 2) throw new Error("outbox unavailable");
    };
    try {
      expect(() =>
        store.bulkUpdateIssues("owner", {
          idempotencyKey: "bulk-mid-flight-failure",
          issueIds: issues.map((issue) => issue.id),
          patch: { priority: "urgent" },
        }),
      ).toThrow("outbox unavailable");
    } finally {
      internals.recordOutbox = originalRecordOutbox;
    }
    expect(issues).toEqual(before.issues);
    expect(store.activities).toEqual(before.activities);
    expect(store.outbox).toEqual(before.outbox);
    expect([...store.receipts.entries()]).toEqual(before.receipts);
  });
});
