import { describe, expect, it } from "vitest";
import { ServiceError } from "./errors";
import { OrbitStore } from "./store";

function setup() {
  let now = 1_700_000_000_000;
  const store = new OrbitStore(() => now);
  store.ensureOwner("owner", "owner@example.com");
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("OrbitStore issue mutations", () => {
  it("[代表値] OwnerスコープでTASK番号を単調採番する", () => {
    const { store } = setup();
    const first = store.createIssue("owner", {
      idempotencyKey: "create-001",
      title: "最初のIssue",
    });
    const second = store.createIssue("owner", {
      idempotencyKey: "create-002",
      title: "二つ目のIssue",
    });

    expect(first.identifier).toBe("TASK-1");
    expect(second.identifier).toBe("TASK-2");
    expect(store.listIssues("owner")).toHaveLength(2);
  });

  it("[状態遷移] 同じMutationの再送はNo-op、異なるRequestは409になる", () => {
    const { store } = setup();
    const input = { idempotencyKey: "create-003", title: "再送対象" };
    const first = store.createIssue("owner", input);
    const replay = store.createIssue("owner", input);

    expect(replay).toEqual(first);
    expect(store.activities).toHaveLength(1);
    expect(store.outbox).toHaveLength(1);
    expect(() => store.createIssue("owner", { ...input, title: "別の内容" })).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 }),
    );
  });

  it("[同時実行] 同じversionのIssue更新は1件だけ成功する", () => {
    const { store } = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "create-004",
      title: "競合するIssue",
    });
    const updated = store.updateIssue("owner", {
      id: issue.id,
      version: 1,
      idempotencyKey: "update-001",
      patch: { priority: "high", description: "確定した説明" },
    });

    expect(updated.version).toBe(2);
    expect(updated.description).toBe("確定した説明");
    const activityCount = store.activities.length;
    const outboxCount = store.outbox.length;
    expect(() =>
      store.updateIssue("owner", {
        id: issue.id,
        version: 1,
        idempotencyKey: "update-002",
        patch: { priority: "urgent", description: "古い説明" },
      }),
    ).toThrowError(expect.objectContaining({ code: "ISSUE_VERSION_CONFLICT", status: 409 }));
    expect(store.issues.get(issue.id)?.description).toBe("確定した説明");
    expect(store.activities).toHaveLength(activityCount);
    expect(store.outbox).toHaveLength(outboxCount);
    expect(store.activities.filter((event) => event.entityId === issue.id)).toHaveLength(2);
    expect(store.outbox.filter((event) => event.type === "issue.updated")).toHaveLength(1);
  });

  it("[状態遷移] Issueをゴミ箱へ移動し、同じKeyの再送をNo-opにする", () => {
    const { store } = setup();
    const issue = store.createIssue("owner", {
      idempotencyKey: "create-trash-001",
      title: "削除対象",
    });

    const trashed = store.trashIssue("owner", issue.id, "trash-001");
    expect(trashed.deletedAt).not.toBeNull();
    expect(store.listIssues("owner")).toHaveLength(0);
    expect(store.trashIssue("owner", issue.id, "trash-001")).toEqual(trashed);

    const restored = store.restoreIssue("owner", issue.id, "restore-001");
    expect(restored.deletedAt).toBeNull();
    expect(store.listIssues("owner")).toHaveLength(1);
  });
});

describe("OrbitStore cycle and background runs", () => {
  it("[デシジョンテーブル] Cycle繰越はUnstarted / Startedだけを移動する", () => {
    const { store } = setup();
    const states = store.ownedWorkflowStates("owner");
    const cycle: Parameters<typeof store.closeCycle>[1] = "cycle-1";
    store.cycles.set(cycle, {
      id: cycle,
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
    const next = "cycle-2";
    store.cycles.set(next, {
      id: next,
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
    const issueFor = (
      key: string,
      category: "backlog" | "unstarted" | "started" | "completed" | "canceled",
    ) =>
      store.createIssue("owner", {
        idempotencyKey: key,
        title: key,
        statusId: states.find((state) => state.category === category)!.id,
        cycleId: cycle,
      });
    const backlog = issueFor("cycle-backlog", "backlog");
    const todo = issueFor("cycle-todo", "unstarted");
    const started = issueFor("cycle-started", "started");
    const done = issueFor("cycle-done", "completed");
    const canceled = issueFor("cycle-canceled", "canceled");

    store.closeCycle("owner", cycle, "close-cycle-1");

    expect(store.cycles.get(cycle)?.status).toBe("completed");
    expect(store.issues.get(todo.id)?.cycleId).toBe(next);
    expect(store.issues.get(started.id)?.cycleId).toBe(next);
    expect(store.issues.get(backlog.id)?.cycleId).toBe(cycle);
    expect(store.issues.get(done.id)?.cycleId).toBe(cycle);
    expect(store.issues.get(canceled.id)?.cycleId).toBe(cycle);
    expect(store.cycleHistory).toHaveLength(2);
    expect(store.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(1);
    const outboxCount = store.outbox.length;
    const receiptCount = store.receipts.size;
    const cycleCount = store.cycles.size;
    expect(store.closeCycle("owner", cycle, "close-cycle-1").status).toBe("completed");
    expect(store.outbox).toHaveLength(outboxCount);
    expect(store.receipts.size).toBe(receiptCount);
    expect(store.cycles.size).toBe(cycleCount);
  });

  it("[状態遷移] Background Runはlock中の業務Mutationを423で拒否し、3 Stepを順序実行する", () => {
    const { store } = setup();
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "run-key-001" });
    expect(run.status).toBe("running");
    expect(() =>
      store.createIssue("owner", { idempotencyKey: "blocked-01", title: "ロック中" }),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_IN_PROGRESS", status: 423 }));

    let cursor: string | null = null;
    let current = run;
    for (let index = 0; index < 3; index += 1) {
      const result = store.continueRun("owner", run.run_id, {
        idempotencyKey: `continue-${index}`,
        expected_cursor: cursor,
      });
      cursor = result.cursor;
      current = store.getRun("owner", run.run_id);
    }
    expect(current.status).toBe("succeeded");
    expect(current.progress.step_index).toBe(3);
    expect(store.currentRun("owner")).toBeNull();
  });

  it("[境界値] Lease期限ちょうどでpausedになり、同じRunをresumeできる", () => {
    const { store, advance } = setup();
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "run-key-002" });
    advance(30_000);

    expect(store.currentRun("owner")?.status).toBe("paused");
    expect(() =>
      store.continueRun("owner", run.run_id, {
        idempotencyKey: "continue-old",
        expected_cursor: null,
      }),
    ).toThrowError(expect.objectContaining({ code: "RUN_REQUIRES_RESUME", status: 409 }));
    const resumed = store.resumeRun("owner", run.run_id);
    expect(resumed.status).toBe("running");
    expect(resumed.resume_count).toBe(1);
  });
});

describe("ServiceError shape", () => {
  it("外部へ出すerror codeとstatusを保持する", () => {
    const error = new ServiceError(400, "VALIDATION_ERROR", "invalid", { title: ["required"] });
    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      fieldErrors: { title: ["required"] },
    });
  });
});
