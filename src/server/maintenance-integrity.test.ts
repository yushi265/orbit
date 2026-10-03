import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { readStoreSnapshot } from "../db/repositories/store-snapshot";
import type { RuntimeEnvironment } from "./auth";
import { ServiceError } from "./errors";
import { json, withOwner, type HandlerContext } from "./http";
import { openStoreSession } from "./store-session";
import { OrbitStore } from "./store";

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  let now = 1_700_000_000_000;
  const store = new OrbitStore(() => now);
  store.ensureOwner("owner", "owner@example.com");
  return {
    store,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function overdueCycles(store: OrbitStore, now: number, count = 26) {
  const cycles = Array.from({ length: count + 1 }, (_, index) => ({
    id: `cycle-${index}`,
    userId: "owner",
    number: index + 1,
    name: `Cycle ${index + 1}`,
    nameOverride: null,
    description: "",
    startsAt: now + (index === count ? DAY : (index - count) * DAY),
    endsAt: now + (index === count ? 2 * DAY : (index - count + 1) * DAY),
    status: index === 0 ? ("active" as const) : ("upcoming" as const),
    completedAt: null,
    scheduleOverridden: false,
  }));
  cycles.forEach((cycle) => store.cycles.set(cycle.id, cycle));
  return cycles;
}

class SnapshotD1 {
  readonly rows = new Map<string, { version: number; stateJson: string; updatedAt: number }>();
  writeFailure: "conflict" | "error" | null = null;

  prepare() {
    let values: unknown[] = [];
    const statement = {
      bind: (...parameters: unknown[]) => {
        values = parameters;
        return statement;
      },
      first: async () => this.rows.get(String(values[0])) ?? null,
      run: async () => {
        if (this.writeFailure === "error") throw new Error("D1 unavailable");
        const [userId, version, stateJson, updatedAt, expectedVersion] = values as [
          string,
          number,
          string,
          number,
          number,
        ];
        const current = this.rows.get(userId);
        if (this.writeFailure === "conflict" || (current && current.version !== expectedVersion))
          return { meta: { changes: 0 } };
        this.rows.set(userId, { version, stateJson, updatedAt });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

function databaseBoundary(database: SnapshotD1, userId = "owner") {
  const db = database as unknown as D1Database;
  const environment = { APP_ENV: "production", DB: db };
  const owner = { userId, email: `${userId}@example.com`, accessAuthenticated: true };
  const request = (
    path: string,
    handler: (context: HandlerContext) => Promise<Response>,
    method = "POST",
  ) =>
    withOwner(
      new Request(`https://orbit.example/api/v1/${path}`, {
        method,
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      handler,
      {
        runtimeEnv: async () => environment as unknown as RuntimeEnvironment,
        resolveOwner: async () => owner,
      },
    );
  const start = (key: string) =>
    request("background-runs", async ({ owner: contextOwner }) => {
      const run = contextOwner.store.startRun(contextOwner.userId, {
        kind: "maintenance",
        idempotencyKey: key,
      });
      return json({ run: contextOwner.store.publicRun(run) }, 202);
    });
  const reload = () => openStoreSession(owner.userId, owner.email, environment);
  const read = (runId: string) =>
    request(
      `background-runs/${runId}`,
      async ({ owner: contextOwner }) =>
        json({
          run: contextOwner.store.publicRun(contextOwner.store.getRun(contextOwner.userId, runId)),
        }),
      "GET",
    );
  return { db, request, start, reload, read };
}

describe("Maintenance integrity", () => {
  it("[異常系] 存在しないCycleでIssueを作成すると404で副作用が残らない", () => {
    const { store } = setup();
    const before = store.toSnapshot();

    expect(() =>
      store.createIssue("owner", {
        idempotencyKey: "missing-cycle-issue",
        title: "Missing cycle",
        cycleId: "missing-cycle",
      }),
    ).toThrowError(expect.objectContaining({ status: 404, code: "RESOURCE_NOT_FOUND" }));
    expect(store.toSnapshot()).toEqual(before);
  });

  it("[セキュリティ境界] 他OwnerのCycleでも404で採番・Receipt・Auditが増えない", () => {
    const { store } = setup();
    store.ensureOwner("other", "other@example.com");
    const foreignCycle = store.bootstrap("other").cycles[0];
    const before = store.toSnapshot();

    expect(() =>
      store.createIssue("owner", {
        idempotencyKey: "foreign-cycle-issue",
        title: "Foreign cycle",
        cycleId: foreignCycle.id,
      }),
    ).toThrowError(expect.objectContaining({ status: 404, code: "RESOURCE_NOT_FOUND" }));
    expect(store.toSnapshot()).toEqual(before);
  });

  it.each([500, 501])(
    "[境界値/状態遷移] %d件の未完了Issueを繰り越し、他カテゴリは残す",
    (count) => {
      const { store } = setup();
      const cycles = store.bootstrap("owner").cycles;
      const active = cycles.find((cycle) => cycle.status === "active")!;
      const next = cycles.find((cycle) => cycle.number === active.number + 1)!;
      const statuses = store.ownedWorkflowStates("owner");
      const moving = Array.from({ length: count }, (_, index) =>
        store.createIssue("owner", {
          idempotencyKey: `moving-${index}`,
          title: `Moving ${index}`,
          cycleId: active.id,
          statusId: statuses.find(
            (state) => state.category === (index % 2 ? "started" : "unstarted"),
          )!.id,
        }),
      );
      const staying = ["backlog", "completed", "canceled"].map((category) =>
        store.createIssue("owner", {
          idempotencyKey: `staying-${category}`,
          title: `Staying ${category}`,
          cycleId: active.id,
          statusId: statuses.find((state) => state.category === category)!.id,
        }),
      );

      store.closeCycle("owner", active.id, "close-501");

      expect(moving.every((issue) => issue.cycleId === next.id)).toBe(true);
      expect(staying.every((issue) => issue.cycleId === active.id)).toBe(true);
      expect(store.cycleHistory).toHaveLength(count);
      expect(store.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(1);
      expect(store.outbox.find((event) => event.type === "cycle.completed")?.payload.moved).toBe(
        count,
      );
      const after = store.toSnapshot();
      store.closeCycle("owner", active.id, "close-501");
      expect(store.toSnapshot()).toEqual(after);
    },
  );

  it("[境界値] Purge 26対象は25件でStepを完了せず、再送はNo-opである", () => {
    const { store, now, advance } = setup();
    const issues = Array.from({ length: 26 }, (_, index) =>
      store.createIssue("owner", {
        idempotencyKey: `purge-${index}`,
        title: `Purge ${index}`,
      }),
    );
    for (const issue of issues) store.trashIssue("owner", issue.id, `trash-${issue.id}`);
    advance(31 * DAY);
    for (const receipt of store.receipts.values()) receipt.expiresAt = now() + DAY;
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "purge-run" });
    const initial = store.continueRun("owner", run.run_id, {
      idempotencyKey: "cycle-step",
      expected_cursor: null,
    });
    const first = store.continueRun("owner", run.run_id, {
      idempotencyKey: "purge-first",
      expected_cursor: initial.cursor,
    });

    expect(first.processed_count).toBe(25);
    expect(first.step).toBe("purge");
    expect(first.cursor).not.toBe(initial.cursor);
    expect(run.stepStatuses.purge).toBe("running");
    const afterFirst = store.toSnapshot();
    const replay = store.continueRun("owner", run.run_id, {
      idempotencyKey: "purge-first",
      expected_cursor: initial.cursor,
    });
    expect(replay.processed_count).toBe(0);
    expect(store.toSnapshot()).toEqual(afterFirst);

    const second = store.continueRun("owner", run.run_id, {
      idempotencyKey: "purge-second",
      expected_cursor: first.cursor,
    });
    expect(second.processed_count).toBe(1);
    expect(second.step).toBe("outbox_retry");
    expect(store.issues.size).toBe(0);
  });

  it("[境界値/セキュリティ境界] Outbox 51対象を25・25・1件で完走し他Ownerを変更しない", () => {
    const { store } = setup();
    for (let index = 0; index < 51; index += 1)
      store.createIssue("owner", {
        idempotencyKey: `outbox-${index}`,
        title: `Outbox ${index}`,
      });
    store.ensureOwner("other", "other@example.com");
    store.createIssue("other", { idempotencyKey: "foreign-outbox", title: "Foreign" });
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "outbox-run" });
    let cursor: string | null = null;
    for (let index = 0; index < 2; index += 1)
      cursor = store.continueRun("owner", run.run_id, {
        idempotencyKey: `pre-outbox-${index}`,
        expected_cursor: cursor,
      }).cursor;
    for (const [index, expected] of [25, 25, 1].entries()) {
      const input = { idempotencyKey: `outbox-chunk-${index}`, expected_cursor: cursor };
      const result = store.continueRun("owner", run.run_id, input);
      expect(result.processed_count).toBe(expected);
      expect(result.run.status).toBe(index === 2 ? "succeeded" : "running");
      const afterChunk = store.toSnapshot();
      expect(store.continueRun("owner", run.run_id, input).processed_count).toBe(0);
      expect(store.toSnapshot()).toEqual(afterChunk);
      cursor = result.cursor;
    }
    expect(
      store.outbox.filter((event) => event.userId === "owner" && event.status === "sent"),
    ).toHaveLength(51);
    expect(
      store.outbox.every((event) => event.attemptCount === (event.userId === "owner" ? 1 : 0)),
    ).toBe(true);
    expect(store.outbox.find((event) => event.userId === "other")?.status).toBe("pending");
  });

  it("[境界値/状態遷移] Cycle遷移51対象をChunk間のLease失効・Snapshot復元後も完走する", () => {
    const { store, now, advance } = setup();
    overdueCycles(store, now());
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "cycle-chunk-run" });
    const first = store.continueRun("owner", run.run_id, {
      idempotencyKey: "first-cycle-chunk",
      expected_cursor: null,
    });
    expect(first.processed_count).toBe(25);
    expect(first.step).toBe("cycle_transition");
    const oldToken = store.lockTokenFor("owner", run.run_id);
    advance(30_000);
    expect(store.currentRun("owner")?.status).toBe("paused");
    const restored = OrbitStore.fromSnapshot(store.toSnapshot(), now, "owner");
    restored.resumeRun("owner", run.run_id);
    const beforeStale = restored.toSnapshot();
    expect(() =>
      restored.continueRun(
        "owner",
        run.run_id,
        {
          idempotencyKey: "stale-token",
          expected_cursor: first.cursor,
        },
        oldToken,
      ),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(restored.toSnapshot()).toEqual(beforeStale);
    expect(
      restored.continueRun("owner", run.run_id, {
        idempotencyKey: "replay-first-cycle-chunk",
        expected_cursor: null,
      }).processed_count,
    ).toBe(0);
    let cursor = first.cursor;
    for (const [index, expected] of [25, 1].entries()) {
      const result = restored.continueRun("owner", run.run_id, {
        idempotencyKey: `remaining-cycle-${index}`,
        expected_cursor: cursor,
      });
      expect(result.processed_count).toBe(expected);
      expect(result.step).toBe(index === 0 ? "cycle_transition" : "purge");
      cursor = result.cursor;
    }
    expect(
      restored.listCycles("owner").filter((cycle) => cycle.status === "completed"),
    ).toHaveLength(26);
    expect(restored.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(26);
    expect(restored.outbox.filter((event) => event.type === "cycle.started")).toHaveLength(25);
  });

  it("[境界値/デシジョンテーブル] PurgeのIssue・Project混在51対象も漏れなく処理する", () => {
    const { store, now, advance } = setup();
    for (let index = 0; index < 26; index += 1) {
      const issue = store.createIssue("owner", {
        idempotencyKey: `mixed-${index}`,
        title: `Mixed ${index}`,
      });
      store.trashIssue("owner", issue.id, `mixed-trash-${index}`);
    }
    for (let index = 0; index < 25; index += 1) {
      const project = store.createProject("owner", {
        idempotencyKey: `project-${index}`,
        name: `Project ${index}`,
      });
      project.deletedAt = now();
    }
    store.ensureOwner("other", "other@example.com");
    const foreign = store.createIssue("other", {
      idempotencyKey: "foreign-trash",
      title: "Foreign trash",
    });
    store.trashIssue("other", foreign.id, "trash-foreign");
    advance(31 * DAY);
    const fresh = store.createIssue("owner", {
      idempotencyKey: "fresh-trash",
      title: "Fresh trash",
    });
    store.trashIssue("owner", fresh.id, "trash-fresh");
    for (const receipt of store.receipts.values()) receipt.expiresAt = now() + DAY;
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "mixed-purge-run" });
    let cursor = store.continueRun("owner", run.run_id, {
      idempotencyKey: "mixed-cycle-step",
      expected_cursor: null,
    }).cursor;
    for (const [index, count] of [25, 25, 1].entries()) {
      const result = store.continueRun("owner", run.run_id, {
        idempotencyKey: `mixed-chunk-${index}`,
        expected_cursor: cursor,
      });
      expect(result.processed_count).toBe(count);
      expect(result.step).toBe(index < 2 ? "purge" : "outbox_retry");
      cursor = result.cursor;
    }
    expect([...store.issues.keys()]).toEqual([foreign.id, fresh.id]);
    expect(store.projects.size).toBe(0);
  });

  it("[状態遷移/セキュリティ境界] Issue PurgeはFK依存を削除し、生存子の親を解除する", () => {
    const { store, now, advance } = setup();
    const parent = store.createIssue("owner", { idempotencyKey: "parent", title: "Parent" });
    const child = store.createIssue("owner", {
      idempotencyKey: "child",
      title: "Child",
      parentId: parent.id,
    });
    const sibling = store.createIssue("owner", { idempotencyKey: "sibling", title: "Sibling" });
    const parentNote = store.createIssueNote("owner", parent.id, {
      idempotencyKey: "parent-note",
      body: "Parent note",
    });
    const childNote = store.createIssueNote("owner", child.id, {
      idempotencyKey: "child-note",
      body: "Child note",
    });
    const outgoing = store.createIssueRelation("owner", parent.id, {
      idempotencyKey: "outgoing",
      targetIssueId: child.id,
      type: "related",
    });
    const incoming = store.createIssueRelation("owner", sibling.id, {
      idempotencyKey: "incoming",
      targetIssueId: parent.id,
      type: "blocking",
    });
    const surviving = store.createIssueRelation("owner", child.id, {
      idempotencyKey: "surviving",
      targetIssueId: sibling.id,
      type: "related",
    });
    store.recordRecentIssueView("owner", parent.id, "view-parent");
    store.recordRecentIssueView("owner", child.id, "view-child");
    const cycles = store.bootstrap("owner").cycles;
    for (const issue of [parent, child])
      store.cycleHistory.push({
        id: `history-${issue.id}`,
        userId: "owner",
        issueId: issue.id,
        fromCycleId: cycles[0].id,
        toCycleId: cycles[1].id,
        movedAt: now(),
      });
    store.ensureOwner("other", "other@example.com");
    const foreign = store.createIssue("other", {
      idempotencyKey: "foreign-parent",
      title: "Foreign",
    });
    const foreignNote = store.createIssueNote("other", foreign.id, {
      idempotencyKey: "foreign-note",
      body: "Foreign",
    });
    store.recordRecentIssueView("other", foreign.id, "view-foreign");
    store.trashIssue("owner", parent.id, "trash-parent");
    const childVersion = child.version;
    const parentAudit = store.activities.filter((event) => event.entityId === parent.id);
    const parentOutbox = store.outbox.filter((event) => event.payload.issueId === parent.id);
    advance(31 * DAY);
    const run = store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "dependency-purge",
    });
    const first = store.continueRun("owner", run.run_id, {
      idempotencyKey: "dependency-cycle",
      expected_cursor: null,
    });
    store.continueRun("owner", run.run_id, {
      idempotencyKey: "dependency-chunk",
      expected_cursor: first.cursor,
    });

    expect(store.issues.has(parent.id)).toBe(false);
    expect(store.notes.has(parentNote.id)).toBe(false);
    expect(store.notes.has(childNote.id)).toBe(true);
    expect(store.notes.has(foreignNote.id)).toBe(true);
    expect(store.relations.has(outgoing.id)).toBe(false);
    expect(store.relations.has(incoming.id)).toBe(false);
    expect(store.relations.has(surviving.id)).toBe(true);
    expect([...store.recentIssueViews.values()].map((record) => record.issueId).sort()).toEqual(
      [child.id, foreign.id].sort(),
    );
    expect(store.cycleHistory.map((history) => history.issueId)).toEqual([child.id]);
    expect(child).toMatchObject({ parentId: null, version: childVersion + 1, updatedAt: now() });
    expect(parentAudit.length).toBeGreaterThan(0);
    expect(store.activities.filter((event) => event.entityId === parent.id)).toEqual([]);
    expect(store.outbox.filter((event) => event.payload.issueId === parent.id)).toEqual(
      parentOutbox,
    );
    const restored = OrbitStore.fromSnapshot(store.toSnapshot());
    expect(restored.getIssueDetail("owner", child.id).parent).toBeNull();
  });

  it("[レイヤー内結合] 423で拒否したRunをD1へ保存し、Lock解放後も同じKeyを拒否する", async () => {
    const database = new SnapshotD1();
    const boundary = databaseBoundary(database);
    expect((await boundary.start("first-run")).status).toBe(202);
    expect((await boundary.start("rejected-run")).status).toBe(423);
    const session = await boundary.reload();
    const rejected = [...session.store.runs.values()].find(
      (run) => run.idempotencyKey === "rejected-run",
    );
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.finished_at).not.toBeNull();
    const active = session.store.currentRun("owner")!;
    let cursor: string | null = null;
    for (let index = 0; index < 3; index += 1)
      cursor = session.store.continueRun("owner", active.run_id, {
        idempotencyKey: `complete-${index}`,
        expected_cursor: cursor,
      }).cursor;
    await session.persist();
    const beforeReplay = await readStoreSnapshot(boundary.db, "owner");
    const replay = await boundary.start("rejected-run");
    expect(replay.status).toBe(409);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe(
      "BACKGROUND_RUN_REJECTED",
    );
    expect(await readStoreSnapshot(boundary.db, "owner")).toEqual(beforeReplay);
  });

  it("[状態遷移] 拒否変更フラグはSession初期false・拒否時true・保存後falseになる", async () => {
    const boundary = databaseBoundary(new SnapshotD1());
    const session = await boundary.reload();
    expect(session.store.hasRejectedRunStateChanges()).toBe(false);
    session.store.startRun("owner", { kind: "maintenance", idempotencyKey: "flag-first" });
    expect(() =>
      session.store.startRun("owner", { kind: "maintenance", idempotencyKey: "flag-rejected" }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(session.store.hasRejectedRunStateChanges()).toBe(true);
    await session.persist();
    expect(session.store.hasRejectedRunStateChanges()).toBe(false);
    expect((await boundary.reload()).store.hasRejectedRunStateChanges()).toBe(false);
  });

  it("[デシジョンテーブル] 通常Mutationの400・423・500は業務変更をD1へ保存しない", async () => {
    const boundary = databaseBoundary(new SnapshotD1());
    const initial = await boundary.reload();
    await initial.persist();
    const before = await readStoreSnapshot(boundary.db, "owner");
    for (const status of [400, 423, 500]) {
      const response = await boundary.request("issues", async ({ owner }) => {
        owner.store.createIssue("owner", {
          idempotencyKey: `failed-${status}`,
          title: "Must rollback",
        });
        throw new ServiceError(
          status,
          status === 423 ? "OPERATION_IN_PROGRESS" : "VALIDATION_ERROR",
          "Failure",
        );
      });
      expect(response.status).toBe(status);
      expect(await readStoreSnapshot(boundary.db, "owner")).toEqual(before);
    }
    expect((await boundary.reload()).store.issues.size).toBe(0);
  });

  it("[セキュリティ境界] Run作成以外のRouteは拒否フラグが立っても保存しない", async () => {
    const boundary = databaseBoundary(new SnapshotD1());
    await boundary.start("scope-first");
    const before = await readStoreSnapshot(boundary.db, "owner");
    const response = await boundary.request("issues", async ({ owner }) => {
      owner.store.startRun("owner", { kind: "maintenance", idempotencyKey: "scope-rejected" });
      return json({ ok: true });
    });
    expect(response.status).toBe(423);
    expect(await readStoreSnapshot(boundary.db, "owner")).toEqual(before);
  });

  it.each([
    ["conflict", 409, "D1_WRITE_CONFLICT"],
    ["error", 500, "INTERNAL_ERROR"],
  ] as const)(
    "[障害注入] 拒否RunのD1保存が%sなら%dを返して保存済みとしない",
    async (failure, status, code) => {
      const database = new SnapshotD1();
      const boundary = databaseBoundary(database);
      await boundary.start("write-failure-first");
      const before = await readStoreSnapshot(boundary.db, "owner");
      database.writeFailure = failure;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await boundary.start("write-failure-rejected");
        expect(response.status).toBe(status);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
        expect(await readStoreSnapshot(boundary.db, "owner")).toEqual(before);
        const session = await boundary.reload();
        expect(session.store.runs.size).toBe(1);
        expect(() =>
          session.store.startRun("owner", {
            kind: "maintenance",
            idempotencyKey: "direct-write-failure",
          }),
        ).toThrowError(expect.objectContaining({ status: 423 }));
        await expect(session.persist()).rejects.toThrow();
        expect(session.store.hasRejectedRunStateChanges()).toBe(true);
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  it.each(["memory", "snapshot"])(
    "[障害注入] %sは失敗Chunkだけrollbackして同じRunから再開する",
    (mode) => {
      const initial = setup();
      overdueCycles(initial.store, initial.now());
      const issue = initial.store.createIssue("owner", {
        idempotencyKey: "rollback-issue",
        title: "Rollback",
        cycleId: "cycle-13",
      });
      initial.store.ensureOwner("other", "other@example.com");
      initial.store.createIssue("other", {
        idempotencyKey: "other-rollback",
        title: "Other owner",
      });
      const run = initial.store.startRun("owner", {
        kind: "maintenance",
        idempotencyKey: "rollback-run",
      });
      const first = initial.store.continueRun("owner", run.run_id, {
        idempotencyKey: "rollback-first",
        expected_cursor: null,
      });
      const store =
        mode === "memory"
          ? initial.store
          : OrbitStore.fromSnapshot(initial.store.toSnapshot(), initial.now);
      const beforeChunk = store.toSnapshot();
      const close = store.closeCycle.bind(store);
      const spy = vi.spyOn(store, "closeCycle").mockImplementationOnce((...args) => {
        close(...args);
        throw new Error("Injected chunk failure");
      });
      const failed = store.continueRun("owner", run.run_id, {
        idempotencyKey: "rollback-failed",
        expected_cursor: first.cursor,
      });
      spy.mockRestore();
      expect(failed.run.status).toBe("failed");
      expect(failed.processed_count).toBe(0);
      expect(failed.cursor).toBe(first.cursor);
      const afterChunk = store.toSnapshot();
      expect({ ...afterChunk, runs: beforeChunk.runs, locks: beforeChunk.locks }).toEqual(
        beforeChunk,
      );
      expect(store.getRun("owner", run.run_id).stepStatuses).toEqual({
        cycle_transition: "failed",
        purge: "skipped",
        outbox_retry: "skipped",
      });
      expect(store.locks.get("owner")?.status).toBe("idle");
      store.resumeRun("owner", run.run_id);
      let cursor = first.cursor;
      for (let index = 0; index < 20; index += 1) {
        const result = store.continueRun("owner", run.run_id, {
          idempotencyKey: `rollback-resume-${index}`,
          expected_cursor: cursor,
        });
        cursor = result.cursor;
        if (result.next === "none") break;
      }
      expect(store.getRun("owner", run.run_id).status).toBe("succeeded");
      expect(store.getRun("owner", run.run_id).progress.processed).toBe(51 + 52);
      expect(store.getIssue("owner", issue.id)).toMatchObject({
        cycleId: "cycle-26",
        version: 14,
        updatedAt: initial.now(),
      });
      expect(store.cycleHistory).toHaveLength(13);
      expect(new Set(store.cycleHistory.map((history) => history.fromCycleId)).size).toBe(13);
      expect(store.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(26);
      expect(store.outbox.filter((event) => event.type === "cycle.started")).toHaveLength(25);
      expect(store.outbox.filter((event) => event.userId === "other")).toMatchObject([
        { status: "pending", attemptCount: 0 },
      ]);
    },
  );

  it("[代表値] SnapshotのIssue・Run・Outboxの深い変更が元Storeへ伝播しない", () => {
    const { store } = setup();
    const issue = store.createIssue("owner", { idempotencyKey: "deep-copy", title: "Original" });
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "deep-copy-run" });
    const snapshot = store.toSnapshot();
    snapshot.issues[0].title = "Changed snapshot";
    snapshot.runs[0].progress.processed = 999;
    snapshot.outbox[0].payload.issueId = "changed-issue";

    expect(store.getIssue("owner", issue.id).title).toBe("Original");
    expect(store.getRun("owner", run.run_id).progress.processed).toBe(0);
    expect(store.outbox[0].payload.issueId).toBe(issue.id);
  });

  it("[障害注入] Cycle生成後の例外でも生成行・Receipt・History・Outboxをrollbackする", () => {
    const { store, now } = setup();
    const active = store.bootstrap("owner").cycles.find((cycle) => cycle.status === "active")!;
    for (const cycle of store.listCycles("owner"))
      if (cycle.id !== active.id) store.cycles.delete(cycle.id);
    active.endsAt = now() - 1;
    const issue = store.createIssue("owner", {
      idempotencyKey: "generation-issue",
      title: "Generation",
      cycleId: active.id,
    });
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "generation-run" });
    const before = store.toSnapshot();
    const close = store.closeCycle.bind(store);
    let generatedCycleCount = 0;
    const spy = vi.spyOn(store, "closeCycle").mockImplementationOnce((...args) => {
      close(...args);
      generatedCycleCount = store.cycles.size;
      throw new Error("Fault after generation");
    });
    const failed = store.continueRun("owner", run.run_id, {
      idempotencyKey: "generation-chunk",
      expected_cursor: null,
    });
    spy.mockRestore();
    expect(generatedCycleCount).toBe(2);
    expect(failed.run.status).toBe("failed");
    const after = store.toSnapshot();
    expect({ ...after, runs: before.runs, locks: before.locks }).toEqual(before);
    expect(store.getIssue("owner", issue.id).version).toBe(1);
    store.resumeRun("owner", run.run_id);
    const resumed = store.continueRun("owner", run.run_id, {
      idempotencyKey: "generation-resume",
      expected_cursor: null,
    });
    expect(resumed.processed_count).toBe(1);
    expect(store.cycles.size).toBe(2);
    expect(store.cycleHistory).toHaveLength(1);
    expect(store.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(1);
    const completeSnapshot = store.toSnapshot();
    expect(
      store.continueRun("owner", run.run_id, {
        idempotencyKey: "generation-resume",
        expected_cursor: null,
      }).processed_count,
    ).toBe(0);
    expect(store.toSnapshot()).toEqual(completeSnapshot);
  });

  it("[レイヤー内結合/障害注入] D1は前Chunkを保ち失敗状態とrollbackを保存して再開できる", async () => {
    const boundary = databaseBoundary(new SnapshotD1());
    const initial = await boundary.reload();
    initial.store.cycles.clear();
    overdueCycles(initial.store, Date.now());
    initial.store.createIssue("owner", {
      idempotencyKey: "d1-rollback-issue",
      title: "D1 rollback",
      cycleId: "cycle-13",
    });
    const run = initial.store.startRun("owner", {
      kind: "maintenance",
      idempotencyKey: "d1-rollback-run",
    });
    const first = initial.store.continueRun("owner", run.run_id, {
      idempotencyKey: "d1-first",
      expected_cursor: null,
    });
    await initial.persist();
    const before = (await boundary.reload()).store.toSnapshot();
    const response = await boundary.request(
      `background-runs/${run.run_id}/continue`,
      async ({ owner }) => {
        const close = owner.store.closeCycle.bind(owner.store);
        const spy = vi.spyOn(owner.store, "closeCycle").mockImplementationOnce((...args) => {
          close(...args);
          throw new Error("D1 chunk fault");
        });
        try {
          return json(
            owner.store.continueRun("owner", run.run_id, {
              idempotencyKey: "d1-failure",
              expected_cursor: first.cursor,
            }),
          );
        } finally {
          spy.mockRestore();
        }
      },
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { run: { status: string }; processed_count: number };
    expect(result).toMatchObject({ run: { status: "failed" }, processed_count: 0 });
    const resumed = await boundary.reload();
    const after = resumed.store.toSnapshot();
    expect({ ...after, runs: before.runs, locks: before.locks }).toEqual(before);
    expect(resumed.store.getRun("owner", run.run_id).progress).toMatchObject({
      cursor: first.cursor,
      processed: 25,
    });
    resumed.store.resumeRun("owner", run.run_id);
    let cursor = first.cursor;
    for (let index = 0; index < 20; index += 1) {
      const chunk = resumed.store.continueRun("owner", run.run_id, {
        idempotencyKey: `d1-complete-${index}`,
        expected_cursor: cursor,
      });
      cursor = chunk.cursor;
      if (chunk.next === "none") break;
    }
    await resumed.persist();
    const completed = (await boundary.reload()).store;
    expect(completed.getRun("owner", run.run_id)).toMatchObject({
      status: "succeeded",
      progress: { processed: 103 },
    });
    expect(completed.cycleHistory).toHaveLength(13);
    expect(new Set(completed.cycleHistory.map((history) => history.fromCycleId)).size).toBe(13);
    expect(
      completed.outbox.every((event) => event.status === "sent" && event.attemptCount === 1),
    ).toBe(true);
  });

  it("[状態遷移] Memory Sessionも拒否フラグをリクエスト開始とpersist後に解除する", async () => {
    const environment = { APP_ENV: "development", ORBIT_STORAGE: "memory" };
    const first = await openStoreSession("memory-flag-owner", "memory@example.com", environment);
    first.store.startRun("memory-flag-owner", {
      kind: "maintenance",
      idempotencyKey: "memory-flag-first",
    });
    expect(() =>
      first.store.startRun("memory-flag-owner", {
        kind: "maintenance",
        idempotencyKey: "memory-flag-rejected",
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(first.store.hasRejectedRunStateChanges()).toBe(true);
    const next = await openStoreSession("memory-flag-owner", "memory@example.com", environment);
    expect(next.store.hasRejectedRunStateChanges()).toBe(false);
    expect(() =>
      next.store.startRun("memory-flag-owner", {
        kind: "maintenance",
        idempotencyKey: "memory-flag-rejected-again",
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    await next.persist();
    expect(next.store.hasRejectedRunStateChanges()).toBe(false);
  });

  it("[境界値] PurgeとOutboxの25件ちょうどは余分なChunkなしでStepを完了する", () => {
    const { store, now, advance } = setup();
    for (let index = 0; index < 25; index += 1) {
      const issue = store.createIssue("owner", {
        idempotencyKey: `exact-${index}`,
        title: `Exact ${index}`,
      });
      store.trashIssue("owner", issue.id, `exact-trash-${index}`);
    }
    advance(31 * DAY);
    for (const receipt of store.receipts.values()) receipt.expiresAt = now() + DAY;
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "exact-25-run" });
    const cycle = store.continueRun("owner", run.run_id, {
      idempotencyKey: "exact-cycle",
      expected_cursor: null,
    });
    const purge = store.continueRun("owner", run.run_id, {
      idempotencyKey: "exact-purge",
      expected_cursor: cycle.cursor,
    });
    expect(purge.processed_count).toBe(25);
    expect(purge.step).toBe("outbox_retry");
    expect(run.stepStatuses.purge).toBe("succeeded");
    const outbox = store.continueRun("owner", run.run_id, {
      idempotencyKey: "exact-outbox",
      expected_cursor: purge.cursor,
    });
    expect(outbox).toMatchObject({
      processed_count: 25,
      step: null,
      next: "none",
      run: { status: "succeeded" },
    });
    expect(run.stepStatuses.outbox_retry).toBe("succeeded");
    expect(store.issues.size).toBe(0);
    expect(store.outbox.every((event) => event.status === "sent" && event.attemptCount === 1)).toBe(
      true,
    );
  });

  it("[セキュリティ境界] D1の同じKeyはOwner別に独立し、拒否Runは他Ownerから404になる", async () => {
    const database = new SnapshotD1();
    const primary = databaseBoundary(database);
    const other = databaseBoundary(database, "other-owner");
    expect((await primary.start("primary-running")).status).toBe(202);
    expect((await primary.start("shared-key")).status).toBe(423);
    const otherResponse = await other.start("shared-key");
    expect(otherResponse.status).toBe(202);
    const otherRun = (await otherResponse.json()) as { run: { run_id: string; status: string } };
    const primaryStore = (await primary.reload()).store;
    const rejected = [...primaryStore.runs.values()].find(
      (run) => run.idempotencyKey === "shared-key",
    )!;
    expect(rejected.status).toBe("rejected");
    expect(rejected.run_id).not.toBe(otherRun.run.run_id);

    const primaryRow = await readStoreSnapshot(primary.db, "owner");
    const otherRow = await readStoreSnapshot(other.db, "other-owner");
    const forbidden = await other.read(rejected.run_id);
    expect(forbidden.status).toBe(404);
    expect(await forbidden.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
    const allowed = await primary.read(rejected.run_id);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      run: { run_id: rejected.run_id, status: "rejected" },
    });
    const primaryReplay = await primary.start("shared-key");
    expect(primaryReplay.status).toBe(409);
    expect(await primaryReplay.json()).toMatchObject({
      error: { code: "BACKGROUND_RUN_REJECTED" },
    });
    const otherReplay = await other.start("shared-key");
    expect(otherReplay.status).toBe(202);
    expect(await otherReplay.json()).toMatchObject({
      run: { run_id: otherRun.run.run_id, status: "running" },
    });
    expect(await readStoreSnapshot(primary.db, "owner")).toEqual(primaryRow);
    expect(await readStoreSnapshot(other.db, "other-owner")).toEqual(otherRow);
    const restoredPrimary = OrbitStore.fromSnapshot(primaryRow!.snapshot, undefined, "owner");
    const restoredOther = OrbitStore.fromSnapshot(otherRow!.snapshot, undefined, "other-owner");
    expect(restoredPrimary.toSnapshot().users.map((user) => user.id)).toEqual(["owner"]);
    expect(restoredOther.toSnapshot().users.map((user) => user.id)).toEqual(["other-owner"]);
    expect([...restoredPrimary.runs.values()].every((run) => run.user_id === "owner")).toBe(true);
    expect([...restoredOther.runs.values()].every((run) => run.user_id === "other-owner")).toBe(
      true,
    );
    expect(restoredPrimary.runs.size).toBe(2);
    expect(restoredOther.runs.size).toBe(1);
  });

  it("[境界値] Cycle遷移25対象ちょうどでも直ちに次Stepへ進む", () => {
    const { store, now } = setup();
    overdueCycles(store, now(), 13);
    const run = store.startRun("owner", { kind: "maintenance", idempotencyKey: "exact-cycle-run" });

    const result = store.continueRun("owner", run.run_id, {
      idempotencyKey: "exact-cycle-25",
      expected_cursor: null,
    });

    expect(result).toMatchObject({ processed_count: 25, step: "purge", next: "continue" });
    expect(run.stepStatuses.cycle_transition).toBe("succeeded");
    expect(store.listCycles("owner").filter((cycle) => cycle.status === "completed")).toHaveLength(
      13,
    );
    expect(store.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(13);
    expect(store.outbox.filter((event) => event.type === "cycle.started")).toHaveLength(12);
  });
});
