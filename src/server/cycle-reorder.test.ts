import { describe, expect, it } from "vitest";
import { OrbitStore } from "./store";

function setup() {
  const store = new OrbitStore(() => 1_700_000_000_000);
  store.ensureOwner("owner", "owner@example.com");
  store.cycles.set("cycle-one", {
    id: "cycle-one",
    userId: "owner",
    number: 1,
    name: "Cycle 1",
    nameOverride: null,
    description: "",
    startsAt: 1,
    endsAt: 2,
    status: "active",
    completedAt: null,
    scheduleOverridden: false,
  });
  store.cycles.set("cycle-two", {
    id: "cycle-two",
    userId: "owner",
    number: 2,
    name: "Cycle 2",
    nameOverride: null,
    description: "",
    startsAt: 3,
    endsAt: 4,
    status: "upcoming",
    completedAt: null,
    scheduleOverridden: false,
  });
  return { store, states: store.ownedWorkflowStates("owner") };
}

describe("OrbitStore Cycle scoped reorder", () => {
  it("[代表値] Cycle List scopeはCycle外Issueの相対位置を変えずに並び替える", () => {
    const { store, states } = setup();
    const todo = states.find((state) => state.category === "unstarted")!.id;
    const first = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-first",
      title: "Cycle 1 first",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const outside = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-outside",
      title: "Cycle 2 issue",
      statusId: todo,
      cycleId: "cycle-two",
    });
    const last = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-last",
      title: "Cycle 1 last",
      statusId: todo,
      cycleId: "cycle-one",
    });

    const moved = store.reorderIssue("owner", {
      idempotencyKey: "cycle-reorder-list-end",
      issueId: first.id,
      version: first.version,
      beforeIssueId: null,
      cycleId: "cycle-one",
    });

    expect(moved.id).toBe(first.id);
    expect(store.listIssues("owner", { order: "manual" }).map((issue) => issue.id)).toEqual([
      last.id,
      outside.id,
      first.id,
    ]);
    expect(store.issues.get(first.id)).toMatchObject({ cycleId: "cycle-one", statusId: todo });
  });

  it("[代表値] Board scopeは同一Status列のposition slotだけを並び替える", () => {
    const { store, states } = setup();
    const todo = states.find((state) => state.category === "unstarted")!.id;
    const started = states.find((state) => state.category === "started")!.id;
    const first = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-board-first",
      title: "Todo first",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const outside = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-board-outside",
      title: "Cycle 2 Todo",
      statusId: todo,
      cycleId: "cycle-two",
    });
    const otherColumn = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-board-other-column",
      title: "Started issue",
      statusId: started,
      cycleId: "cycle-one",
    });
    const last = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-board-last",
      title: "Todo last",
      statusId: todo,
      cycleId: "cycle-one",
    });

    store.reorderIssue("owner", {
      idempotencyKey: "cycle-reorder-board-end",
      issueId: first.id,
      version: first.version,
      beforeIssueId: null,
      cycleId: "cycle-one",
      statusId: todo,
    });

    expect(store.listIssues("owner", { order: "manual" }).map((issue) => issue.id)).toEqual([
      last.id,
      outside.id,
      otherColumn.id,
      first.id,
    ]);
    expect(store.issues.get(first.id)).toMatchObject({ cycleId: "cycle-one", statusId: todo });
  });

  it("[デシジョンテーブル] Cycle / Status scope外の参照を副作用なしで拒否する", () => {
    const { store, states } = setup();
    const todo = states.find((state) => state.category === "unstarted")!.id;
    const started = states.find((state) => state.category === "started")!.id;
    const first = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-boundary-first",
      title: "Cycle 1 first",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const outside = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-boundary-outside",
      title: "Cycle 2 issue",
      statusId: todo,
      cycleId: "cycle-two",
    });
    const otherColumn = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-boundary-other-column",
      title: "Cycle 1 started",
      statusId: started,
      cycleId: "cycle-one",
    });
    const before = {
      order: store.listIssues("owner", { order: "manual" }).map((issue) => issue.id),
      positions: [...store.issues.values()].map((issue) => [
        issue.id,
        issue.position,
        issue.version,
      ]),
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    };
    const assertUnchanged = () => {
      expect(store.listIssues("owner", { order: "manual" }).map((issue) => issue.id)).toEqual(
        before.order,
      );
      expect(
        [...store.issues.values()].map((issue) => [issue.id, issue.position, issue.version]),
      ).toEqual(before.positions);
      expect(store.activities.length).toBe(before.activities);
      expect(store.outbox.length).toBe(before.outbox);
      expect(store.receipts.size).toBe(before.receipts);
    };

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-boundary-cycle-mismatch",
        issueId: first.id,
        version: first.version,
        beforeIssueId: null,
        cycleId: "cycle-two",
      }),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_FOUND", status: 404 }));
    assertUnchanged();

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-boundary-before-status-mismatch",
        issueId: first.id,
        version: first.version,
        beforeIssueId: otherColumn.id,
        cycleId: "cycle-one",
        statusId: todo,
      }),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_FOUND", status: 404 }));
    assertUnchanged();

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-boundary-before-mismatch",
        issueId: first.id,
        version: first.version,
        beforeIssueId: outside.id,
        cycleId: "cycle-one",
      }),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_FOUND", status: 404 }));
    assertUnchanged();

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-boundary-status-mismatch",
        issueId: first.id,
        version: first.version,
        beforeIssueId: null,
        cycleId: "cycle-one",
        statusId: started,
      }),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_FOUND", status: 404 }));
    assertUnchanged();

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-boundary-status-only",
        issueId: first.id,
        version: first.version,
        beforeIssueId: null,
        statusId: started,
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR", status: 400 }));
    assertUnchanged();

    store.ensureOwner("foreign-owner", "foreign@example.com");
    store.cycles.set("foreign-cycle", {
      id: "foreign-cycle",
      userId: "foreign-owner",
      number: 1,
      name: "Foreign Cycle",
      nameOverride: null,
      description: "",
      startsAt: 1,
      endsAt: 2,
      status: "active",
      completedAt: null,
      scheduleOverridden: false,
    });
    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-boundary-foreign-cycle",
        issueId: first.id,
        version: first.version,
        beforeIssueId: null,
        cycleId: "foreign-cycle",
      }),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_FOUND", status: 404 }));
    assertUnchanged();
  });

  it("[状態遷移] Cycle scopeのversion / lock / idempotency境界を守る", () => {
    const { store, states } = setup();
    const todo = states.find((state) => state.category === "unstarted")!.id;
    const first = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-state-first",
      title: "先頭",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const last = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-state-last",
      title: "末尾",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const initialOrder = store.listIssues("owner", { order: "manual" }).map((issue) => issue.id);
    const initialActivities = store.activities.length;
    const initialOutbox = store.outbox.length;
    const initialReceipts = store.receipts.size;

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-state-stale",
        issueId: last.id,
        version: 0,
        beforeIssueId: first.id,
        cycleId: "cycle-one",
      }),
    ).toThrowError(expect.objectContaining({ code: "ISSUE_VERSION_CONFLICT", status: 409 }));
    expect(store.listIssues("owner", { order: "manual" }).map((issue) => issue.id)).toEqual(
      initialOrder,
    );
    expect(store.activities.length).toBe(initialActivities);
    expect(store.outbox.length).toBe(initialOutbox);
    expect(store.receipts.size).toBe(initialReceipts);

    store.locks.set("owner", {
      userId: "owner",
      runId: "run-cycle-reorder",
      token: "token-cycle-reorder",
      status: "running",
      leaseExpiresAt: 1_700_000_030_000,
    });
    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-state-locked",
        issueId: last.id,
        version: last.version,
        beforeIssueId: first.id,
        cycleId: "cycle-one",
      }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));
    expect(store.listIssues("owner", { order: "manual" }).map((issue) => issue.id)).toEqual(
      initialOrder,
    );
    expect(store.receipts.size).toBe(initialReceipts);
    store.locks.set("owner", {
      userId: "owner",
      runId: null,
      token: null,
      status: "idle",
      leaseExpiresAt: null,
    });

    const input = {
      idempotencyKey: "cycle-reorder-state-replay",
      issueId: last.id,
      version: last.version,
      beforeIssueId: first.id,
      cycleId: "cycle-one",
    };
    const moved = store.reorderIssue("owner", input);
    const afterMove = {
      order: store.listIssues("owner", { order: "manual" }).map((issue) => issue.id),
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    };
    expect(store.reorderIssue("owner", input)).toEqual(moved);
    expect({
      order: store.listIssues("owner", { order: "manual" }).map((issue) => issue.id),
      activities: store.activities.length,
      outbox: store.outbox.length,
      receipts: store.receipts.size,
    }).toEqual(afterMove);
    expect(() => store.reorderIssue("owner", { ...input, beforeIssueId: null })).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 }),
    );
    expect(store.activities.length).toBe(afterMove.activities);
    expect(store.outbox.length).toBe(afterMove.outbox);
    expect(store.receipts.size).toBe(afterMove.receipts);
  });

  it("[代表値] Cycle scopeのpositionはSnapshot round-trip後も維持される", () => {
    const { store, states } = setup();
    const todo = states.find((state) => state.category === "unstarted")!.id;
    const first = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-persistence-first",
      title: "先頭",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const last = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-persistence-last",
      title: "末尾",
      statusId: todo,
      cycleId: "cycle-one",
    });
    store.reorderIssue("owner", {
      idempotencyKey: "cycle-reorder-persistence-move",
      issueId: last.id,
      version: last.version,
      beforeIssueId: first.id,
      cycleId: "cycle-one",
    });

    const restored = OrbitStore.fromSnapshot(JSON.parse(JSON.stringify(store.toSnapshot())));

    expect(restored.listIssues("owner", { order: "manual" }).map((issue) => issue.id)).toEqual(
      store.listIssues("owner", { order: "manual" }).map((issue) => issue.id),
    );
    expect(restored.toSnapshot()).toEqual(store.toSnapshot());
  });

  it("[状態遷移/禁止] Completed Cycleへのscope付きreorderは副作用なしで拒否する", () => {
    const { store, states } = setup();
    const todo = states.find((state) => state.category === "unstarted")!.id;
    const issue = store.createIssue("owner", {
      idempotencyKey: "cycle-reorder-completed-issue",
      title: "Completed Cycle issue",
      statusId: todo,
      cycleId: "cycle-one",
    });
    const completed = store.cycles.get("cycle-one")!;
    completed.status = "completed";
    completed.completedAt = 3;
    const before = store.toSnapshot();

    expect(() =>
      store.reorderIssue("owner", {
        idempotencyKey: "cycle-reorder-completed",
        issueId: issue.id,
        version: issue.version,
        beforeIssueId: null,
        cycleId: completed.id,
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR", status: 400 }));
    expect(store.toSnapshot()).toEqual(before);
  });
});
