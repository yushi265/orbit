import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { readStoreSnapshot, writeStoreSnapshot } from "../db/repositories/store-snapshot";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";
import { json, withOwner } from "./http";
import { ServiceError } from "./errors";
import { OrbitStore, type OrbitStoreSnapshot } from "./store";
import { encodeStoreSnapshot } from "./store-snapshot-compat";
import { openStoreSession } from "./store-session";
import { FakeD1 } from "./store-session.test-fixtures";

const DAY = 24 * 60 * 60 * 1000;
const OWNER = "growth-owner";
const T0 = 1_800_000_000_000;

function clocked(owner = OWNER) {
  let now = T0;
  const store = new OrbitStore(() => now);
  store.ensureOwner(owner, `${owner}@example.com`);
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function receiptOf(store: OrbitStore, key: string, owner = OWNER) {
  return store.receipts.get(`${owner}:${key}`);
}

describe("Receipt TTL と pruneExpiredReceipts", () => {
  it("[代表値] 新規Mutation後のReceiptはexpiresAt - createdAtが24時間", () => {
    const { store } = clocked();
    store.createIssue(OWNER, { idempotencyKey: "ttl-key", title: "t" });
    const receipt = receiptOf(store, "ttl-key")!;
    expect(receipt.expiresAt - receipt.createdAt).toBe(DAY);
  });

  it.each([
    { name: "24時間-1msは残る", elapsed: DAY - 1, kept: true },
    { name: "24時間ちょうどは残る", elapsed: DAY, kept: true },
    { name: "24時間+1msは削除", elapsed: DAY + 1, kept: false },
  ])("[境界値] $name", ({ elapsed, kept }) => {
    const { store, advance } = clocked();
    store.createIssue(OWNER, { idempotencyKey: "boundary", title: "t" });
    advance(elapsed);
    const removed = store.pruneExpiredReceipts(OWNER);
    expect(store.receipts.has(`${OWNER}:boundary`)).toBe(kept);
    expect(removed).toBe(kept ? 0 : 1);
  });

  it("[同値分割] 旧形式(createdAt+30日)は24時間超で削除、expiresAtが早いReceiptはexpiresAt超過で削除", () => {
    const { store, advance } = clocked();
    store.createIssue(OWNER, { idempotencyKey: "legacy", title: "legacy" });
    store.createIssue(OWNER, { idempotencyKey: "early", title: "early" });
    receiptOf(store, "legacy")!.expiresAt = T0 + 30 * DAY;
    receiptOf(store, "early")!.expiresAt = T0 + 1000;
    advance(1001);
    expect(store.pruneExpiredReceipts(OWNER)).toBe(1);
    expect(store.receipts.has(`${OWNER}:early`)).toBe(false);
    expect(store.receipts.has(`${OWNER}:legacy`)).toBe(true);
    advance(DAY);
    expect(store.pruneExpiredReceipts(OWNER)).toBe(1);
    expect(store.receipts.has(`${OWNER}:legacy`)).toBe(false);
  });

  it("[同値分割] 他Ownerの期限切れReceiptは削除しない", () => {
    const { store, advance } = clocked();
    store.ensureOwner("other", "other@example.com");
    store.createIssue(OWNER, { idempotencyKey: "mine", title: "mine" });
    store.createIssue("other", { idempotencyKey: "theirs", title: "theirs" });
    advance(DAY + 1);
    expect(store.pruneExpiredReceipts(OWNER)).toBe(1);
    expect(store.receipts.has("other:theirs")).toBe(true);
  });

  it("[状態遷移] 24時間以内の再送は同じ応答、削除後の同じキーは新しいMutation", () => {
    const { store, advance } = clocked();
    const input = { idempotencyKey: "replay", title: "first" };
    const first = store.createIssue(OWNER, input);
    advance(DAY - 1);
    expect(store.createIssue(OWNER, input).id).toBe(first.id);
    advance(2);
    store.pruneExpiredReceipts(OWNER);
    const second = store.createIssue(OWNER, input);
    expect(second.id).not.toBe(first.id);
  });

  it("[同値分割] 24時間以内に同じキー・異なる内容は409 IDEMPOTENCY_KEY_REUSED", () => {
    const { store } = clocked();
    store.createIssue(OWNER, { idempotencyKey: "reuse", title: "a" });
    expect(() => store.createIssue(OWNER, { idempotencyKey: "reuse", title: "b" })).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 }),
    );
  });
});

describe("D1 Session の Receipt 自動削除", () => {
  async function seeded(options: { rollbackSetting?: boolean } = {}) {
    const database = new FakeD1() as unknown as D1Database;
    const seed = new OrbitStore(() => Date.now() - 10 * DAY);
    seed.ensureOwner(OWNER, "owner@example.com");
    seed.ensureUpcomingCycles(OWNER);
    seed.createIssue(OWNER, { idempotencyKey: "old-receipt", title: "old" });
    let projectId = "";
    if (options.rollbackSetting) {
      const project = seed.createProject(OWNER, { idempotencyKey: "project", name: "P" });
      projectId = project.id;
      seed.updateProjectDisplayPreferences(OWNER, project.id, {
        idempotencyKey: "pref",
        displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "title_desc" },
      });
    }
    await writeStoreSnapshot(database, OWNER, 0, encodeStoreSnapshot(seed.toSnapshot()), T0);
    return { database, projectId, environment: { APP_ENV: "production", DB: database } };
  }

  it("[レイヤー内結合] 期限切れReceiptを含むSnapshot+Mutation成功で、期限切れは消え新Receiptが残る", async () => {
    const { database, environment } = await seeded();
    const session = await openStoreSession(OWNER, "owner@example.com", environment);
    session.store.createIssue(OWNER, { idempotencyKey: "fresh", title: "fresh" });
    await session.persist();
    const saved = (await readStoreSnapshot(database, OWNER))!.snapshot as OrbitStoreSnapshot;
    const keys = saved.receipts.map((receipt) => receipt.idempotencyKey);
    expect(keys).toContain("fresh");
    expect(keys).not.toContain("old-receipt");
  });

  it("[レイヤー内結合] Handler失敗では保存されず、保存を伴わないGETでもversionが進まない", async () => {
    const { database, environment } = await seeded();
    const resolveOwner = async () => ({
      userId: OWNER,
      email: "owner@example.com",
      accessAuthenticated: true,
    });
    const open = (userId: string, email: string) => openStoreSession(userId, email, environment);
    const before = await readStoreSnapshot(database, OWNER);

    const failure = await withOwner(
      new Request("https://orbit.example/api/v1/issues", {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      async () => {
        throw new ServiceError(400, "VALIDATION_ERROR", "invalid");
      },
      { resolveOwner, openStoreSession: open },
    );
    expect(failure.status).toBe(400);

    const get = await withOwner(
      new Request("https://orbit.example/api/v1/issues"),
      async () => json({ ok: true }),
      { resolveOwner, openStoreSession: open },
    );
    expect(get.status).toBe(200);

    const probe = await openStoreSession(OWNER, "owner@example.com", environment);
    expect(probe.needsInitialPersist).toBe(false);
    const after = await readStoreSnapshot(database, OWNER);
    expect(after?.version).toBe(before?.version);
    expect(
      (after!.snapshot as OrbitStoreSnapshot).receipts.map((receipt) => receipt.idempotencyKey),
    ).toContain("old-receipt");
  });

  it("[レイヤー内結合] rollback互換metaを持つSnapshotで、関連Receipt削除後も新設定が復元され、保存形状が維持される", async () => {
    const { database, projectId, environment } = await seeded({ rollbackSetting: true });
    const session = await openStoreSession(OWNER, "owner@example.com", environment);
    session.store.createIssue(OWNER, { idempotencyKey: "fresh", title: "fresh" });
    await session.persist();

    const saved = (await readStoreSnapshot(database, OWNER))!.snapshot as OrbitStoreSnapshot;
    expect(saved.receipts.some((receipt) => receipt.idempotencyKey === "pref")).toBe(false);
    const fresh = saved.receipts.find((receipt) => receipt.idempotencyKey === "fresh")!;
    expect(fresh.requestHash.startsWith("issue.create\n")).toBe(true);
    expect(fresh.response).toBeDefined();

    const reloaded = await openStoreSession(OWNER, "owner@example.com", environment);
    const settings = reloaded.store
      .toSnapshot()
      .projectDisplayPreferences.find((item) => item.projectId === projectId)?.settings;
    expect(settings?.order).toBe("title_desc");
  });
});

describe("reorderIssue の記録対象", () => {
  function setupIssues() {
    const { store, advance } = clocked();
    const issues = ["a", "b", "c", "d"].map((title) =>
      store.createIssue(OWNER, { idempotencyKey: `create-${title}`, title }),
    );
    return { store, issues, advance };
  }
  const count = (store: OrbitStore, type: "activities" | "outbox") => store[type].length;
  const stateOf = (issue: { position: number; version: number; updatedAt: number }) => ({
    position: issue.position,
    version: issue.version,
    updatedAt: issue.updatedAt,
  });
  const orderOf = (issues: { id: string; position: number }[]) =>
    [...issues].sort((left, right) => left.position - right.position).map((issue) => issue.id);

  it("[デシジョンテーブル] 複数Issueがずれる並び替えは対象Issueのみ Activity+1 / Outbox+1、他Issueは位置更新", () => {
    const { store, issues, advance } = setupIssues();
    const [a, b, c, d] = issues;
    const before = new Map(issues.map((issue) => [issue.id, stateOf(issue)]));
    const targetBefore = before.get(d.id)!;
    const activityBefore = count(store, "activities");
    const outboxBefore = count(store, "outbox");
    advance(1_000);

    store.reorderIssue(OWNER, {
      idempotencyKey: "reorder-1",
      issueId: d.id,
      version: targetBefore.version,
      beforeIssueId: a.id,
    });

    expect(orderOf(issues)).toEqual([d.id, a.id, b.id, c.id]);
    expect(d.position).not.toBe(targetBefore.position);
    expect(d.version).toBe(targetBefore.version + 1);
    const newActivities = store.activities.slice(activityBefore);
    const newOutbox = store.outbox.slice(outboxBefore);
    expect(newActivities).toHaveLength(1);
    expect(newActivities[0]).toMatchObject({
      entityType: "issue",
      entityId: d.id,
      action: "reordered",
      mutationKey: `reorder-1:${d.id}`,
      before: { version: targetBefore.version, position: targetBefore.position },
      after: { version: targetBefore.version + 1, position: d.position },
    });
    expect(newOutbox).toHaveLength(1);
    expect(newOutbox[0]).toMatchObject({
      type: "issue.reordered",
      dedupeKey: `issue.reordered:${d.id}:${targetBefore.version + 1}`,
      payload: { issueId: d.id, position: d.position, version: targetBefore.version + 1 },
    });
    for (const shifted of [a, b, c]) {
      const shiftedBefore = before.get(shifted.id)!;
      expect(shifted.position).not.toBe(shiftedBefore.position);
      expect(shifted.version).toBe(shiftedBefore.version + 1);
      expect(shifted.updatedAt).toBe(T0 + 1_000);
    }
  });

  function setupCycleIssues() {
    const { store } = clocked();
    store.cycles.set("cycle-x", {
      id: "cycle-x",
      userId: OWNER,
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
    const statusId = store.ownedWorkflowStates(OWNER).find((s) => s.category === "unstarted")!.id;
    const issues = ["a", "b", "c"].map((title) =>
      store.createIssue(OWNER, {
        idempotencyKey: `cy-${title}`,
        title,
        statusId,
        cycleId: "cycle-x",
      }),
    );
    return { store, issues, statusId };
  }

  it.each([
    { name: "Cycle List", withStatus: false },
    { name: "Cycle Board", withStatus: true },
  ])("[デシジョンテーブル] $name scopeでも対象Issueのみ記録する", ({ withStatus }) => {
    const { store, issues, statusId } = setupCycleIssues();
    const target = issues[2];
    const before = new Map(issues.map((issue) => [issue.id, stateOf(issue)]));
    const targetBefore = before.get(target.id)!;
    const activityBefore = store.activities.length;
    const outboxBefore = store.outbox.length;
    store.reorderIssue(OWNER, {
      idempotencyKey: "cy-reorder",
      issueId: target.id,
      version: targetBefore.version,
      beforeIssueId: issues[0].id,
      cycleId: "cycle-x",
      ...(withStatus ? { statusId } : {}),
    });
    expect(orderOf(issues)).toEqual([target.id, issues[0].id, issues[1].id]);
    const newActivities = store.activities.slice(activityBefore);
    const newOutbox = store.outbox.slice(outboxBefore);
    expect(newActivities).toHaveLength(1);
    expect(newActivities[0]).toMatchObject({
      entityId: target.id,
      action: "reordered",
      mutationKey: `cy-reorder:${target.id}`,
      before: { version: targetBefore.version, position: targetBefore.position },
      after: { version: targetBefore.version + 1, position: target.position },
    });
    expect(newOutbox).toHaveLength(1);
    expect(newOutbox[0]).toMatchObject({
      type: "issue.reordered",
      dedupeKey: `issue.reordered:${target.id}:${targetBefore.version + 1}`,
      payload: { issueId: target.id, position: target.position, version: targetBefore.version + 1 },
    });
    for (const shifted of [issues[0], issues[1]]) {
      const shiftedBefore = before.get(shifted.id)!;
      expect(shifted.position).not.toBe(shiftedBefore.position);
      expect(shifted.version).toBe(shiftedBefore.version + 1);
    }
  });

  it.each([
    { name: "Cycle List", withStatus: false },
    { name: "Cycle Board", withStatus: true },
  ])(
    "[デシジョンテーブル] $name scopeのno-opはActivity・Outbox増分0でReceiptのみ記録",
    ({ withStatus }) => {
      const { store, issues, statusId } = setupCycleIssues();
      const before = issues.map(stateOf);
      const activityBefore = store.activities.length;
      const outboxBefore = store.outbox.length;
      const receiptsBefore = store.receipts.size;
      store.reorderIssue(OWNER, {
        idempotencyKey: "cy-noop",
        issueId: issues[0].id,
        version: issues[0].version,
        beforeIssueId: issues[1].id,
        cycleId: "cycle-x",
        ...(withStatus ? { statusId } : {}),
      });
      expect(issues.map(stateOf)).toEqual(before);
      expect(store.activities.length).toBe(activityBefore);
      expect(store.outbox.length).toBe(outboxBefore);
      expect(store.receipts.size).toBe(receiptsBefore + 1);
    },
  );

  it("[デシジョンテーブル] no-op はActivity・Outbox増分0でReceiptのみ記録", () => {
    const { store, issues } = setupIssues();
    const [a, b] = issues;
    const activityBefore = count(store, "activities");
    const outboxBefore = count(store, "outbox");
    const receiptsBefore = store.receipts.size;
    store.reorderIssue(OWNER, {
      idempotencyKey: "noop",
      issueId: a.id,
      version: a.version,
      beforeIssueId: b.id,
    });
    expect(count(store, "activities")).toBe(activityBefore);
    expect(count(store, "outbox")).toBe(outboxBefore);
    expect(store.receipts.size).toBe(receiptsBefore + 1);
  });

  it("[同値分割] 404 / 409 / 423 は position・version・Activity・Outbox・Receiptを変更しない", () => {
    const { store, issues } = setupIssues();
    const [a, , , d] = issues;
    const snapshot = () =>
      JSON.stringify({
        issues: [...store.issues.values()].map((i) => [i.id, i.position, i.version]),
        activities: store.activities.length,
        outbox: store.outbox.length,
        receipts: store.receipts.size,
      });
    const before = snapshot();

    expect(() =>
      store.reorderIssue(OWNER, {
        idempotencyKey: "r404",
        issueId: d.id,
        version: d.version,
        beforeIssueId: "missing",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      store.reorderIssue(OWNER, {
        idempotencyKey: "r409",
        issueId: d.id,
        version: d.version + 5,
        beforeIssueId: a.id,
      }),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    store.locks.set(OWNER, {
      userId: OWNER,
      runId: "run",
      token: "t",
      status: "running",
      leaseExpiresAt: T0 + DAY,
    });
    expect(() =>
      store.reorderIssue(OWNER, {
        idempotencyKey: "r423",
        issueId: d.id,
        version: d.version,
        beforeIssueId: a.id,
      }),
    ).toThrowError(expect.objectContaining({ status: 423 }));
    expect(snapshot()).toBe(before);
  });

  it("[代表値] 同じキーの再送は初回応答を返し、Activity・Outboxを増やさない", () => {
    const { store, issues } = setupIssues();
    const [a, , , d] = issues;
    const input = {
      idempotencyKey: "replay-reorder",
      issueId: d.id,
      version: d.version,
      beforeIssueId: a.id,
    };
    const first = store.reorderIssue(OWNER, input);
    const activities = count(store, "activities");
    const outbox = count(store, "outbox");
    expect(store.reorderIssue(OWNER, input)).toEqual(first);
    expect(count(store, "activities")).toBe(activities);
    expect(count(store, "outbox")).toBe(outbox);
  });
});

describe("Purge 時の Activity 削除", () => {
  it("[同値分割] PurgeしたIssueのActivityだけが消え、他IssueとOtherOwnerのActivityは残る", () => {
    const { store, advance } = clocked();
    store.ensureOwner("other", "other@example.com");
    const target = store.createIssue(OWNER, { idempotencyKey: "p-target", title: "target" });
    const keep = store.createIssue(OWNER, { idempotencyKey: "p-keep", title: "keep" });
    store.trashIssue(OWNER, target.id, "p-trash");
    store.activities.push({
      id: "other-owner-activity",
      userId: "other",
      entityType: "issue",
      entityId: target.id,
      action: "updated",
      mutationKey: "other-key",
      before: null,
      after: null,
      createdAt: T0,
    } as unknown as (typeof store.activities)[number]);
    expect(store.activities.some((a) => a.userId === OWNER && a.entityId === target.id)).toBe(true);

    advance(31 * DAY);
    const run = store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "p-run" });
    const first = store.continueRun(OWNER, run.run_id, {
      idempotencyKey: "p-cycle",
      expected_cursor: null,
    });
    store.continueRun(OWNER, run.run_id, {
      idempotencyKey: "p-chunk",
      expected_cursor: first.cursor,
    });

    expect(store.issues.has(target.id)).toBe(false);
    expect(store.activities.filter((a) => a.userId === OWNER && a.entityId === target.id)).toEqual(
      [],
    );
    expect(store.activities.some((a) => a.entityId === keep.id)).toBe(true);
    expect(store.activities.some((a) => a.id === "other-owner-activity")).toBe(true);
  });
});
