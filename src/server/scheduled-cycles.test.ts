import type { D1Database } from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoreSnapshot } from "../db/repositories/store-snapshot";
import type { RuntimeEnvironment } from "./auth";
import { runScheduledCycles } from "./scheduled-cycles";
import { OrbitStore } from "./store";
import { decodeStoreSnapshot, encodeStoreSnapshot } from "./store-snapshot-compat";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // Cycle 1 の開始時刻（seed 時点）
const OWNER_ID = "owner-1";
const OWNER_EMAIL = "Owner@Example.com";
const SECRET_TITLE = "SECRET-ISSUE-TITLE";

/** Owner行(users)の読取と、Snapshot行のVersion CAS書込だけを再現するFake。 */
class OwnerSnapshotD1 {
  readonly rows = new Map<string, { version: number; stateJson: string; updatedAt: number }>();
  readonly users = new Map<string, string>();
  snapshotReads = 0;
  /** 次の書込のうち、この回数だけ「競合相手が先に保存した」状態にして失敗させる。 */
  conflictsBeforeSuccess = 0;
  /** trueの間、書込は競合ではない障害として例外を投げる。 */
  failWrites = false;
  writes = 0;

  prepare() {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      raw: async () => {
        const email = this.users.get(String(values[0]));
        return email === undefined ? [] : [[String(values[0]), "Owner", email, null, T0]];
      },
      first: async () => {
        this.snapshotReads += 1;
        return this.rows.get(String(values[0])) ?? null;
      },
      run: async () => {
        const [userId, version, stateJson, updatedAt, expectedVersion] = values as [
          string,
          number,
          string,
          number,
          number,
        ];
        this.writes += 1;
        if (this.failWrites) throw new Error("d1 down");
        const current = this.rows.get(userId);
        if (this.conflictsBeforeSuccess > 0 && current) {
          this.conflictsBeforeSuccess -= 1;
          this.rows.set(userId, {
            version: current.version + 1,
            stateJson: current.stateJson,
            updatedAt: COMPETITOR_MARK,
          });
          return { meta: { changes: 0 } };
        }
        if (current && current.version !== expectedVersion) return { meta: { changes: 0 } };
        this.rows.set(userId, { version, stateJson, updatedAt });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

const COMPETITOR_MARK = 999;

type Fixture = {
  db: OwnerSnapshotD1;
  env: RuntimeEnvironment;
};

function production(db: OwnerSnapshotD1, extra: Partial<RuntimeEnvironment> = {}) {
  return {
    APP_ENV: "production",
    OWNER_USER_ID: OWNER_ID,
    OWNER_EMAIL,
    DB: db as unknown as D1Database,
    ...extra,
  } as unknown as RuntimeEnvironment;
}

/** T0にensureUpcomingCyclesまで済んだ平常のSnapshotを作り、必要ならseedで加工する。 */
function seedStore(
  db: OwnerSnapshotD1,
  options: {
    userId?: string;
    email?: string;
    mutate?: (store: OrbitStore, setClock: (value: number) => void) => void;
  } = {},
) {
  const userId = options.userId ?? OWNER_ID;
  const email = options.email ?? OWNER_EMAIL;
  let clock = T0;
  const store = new OrbitStore(() => clock);
  store.ensureOwner(userId, email);
  store.ensureUpcomingCycles(userId);
  options.mutate?.(store, (value) => {
    clock = value;
  });
  db.rows.set(userId, {
    version: 1,
    stateJson: JSON.stringify(encodeStoreSnapshot(store.toSnapshot())),
    updatedAt: 1,
  });
  db.users.set(userId, email);
}

async function reload(db: OwnerSnapshotD1, userId = OWNER_ID) {
  const row = await readStoreSnapshot(db as unknown as D1Database, userId);
  if (!row) throw new Error("snapshot row is missing");
  return {
    version: row.version,
    updatedAt: row.updatedAt,
    store: OrbitStore.fromSnapshot(decodeStoreSnapshot(row.snapshot), undefined, userId),
  };
}

const cycleByNumber = (store: OrbitStore, number: number, userId = OWNER_ID) =>
  store.listCycles(userId).find((cycle) => cycle.number === number);

function setup(): Fixture {
  const db = new OwnerSnapshotD1();
  return { db, env: production(db) };
}

/** Cycle 1(T0開始・2週間)の終了後、境界処理が必要になる時刻。 */
const AFTER_CYCLE_1 = T0 + 15 * DAY;

describe("runScheduledCycles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("[代表値] 期限切れActiveを持つSnapshot → completed / persisted / attempts 1、versionが1進む", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);

    const result = await runScheduledCycles(env);

    expect(result).toMatchObject({
      outcome: "completed",
      persisted: true,
      attempts: 1,
    });
    expect((result as { processed: number }).processed).toBeGreaterThanOrEqual(1);
    const after = await reload(db);
    expect(after.version).toBe(2);
    expect(cycleByNumber(after.store, 1)?.status).toBe("completed");
  });

  it("[代表値] 境界なし・補充不要 → processed 0 / persisted false、versionは不変", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.setSystemTime(T0 + DAY);

    const result = await runScheduledCycles(env);

    expect(result).toEqual({
      outcome: "completed",
      processed: 0,
      hasRemaining: false,
      persisted: false,
      attempts: 1,
    });
    expect((await reload(db)).version).toBe(1);
  });

  it("[代表値] 続けて2回実行 → 2回目はpersisted falseでversion不変", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);
    await runScheduledCycles(env);
    const afterFirst = await reload(db);

    const second = await runScheduledCycles(env);

    expect(second).toMatchObject({ processed: 0, persisted: false });
    expect((await reload(db)).version).toBe(afterFirst.version);
  });

  it("[代表値] Upcomingがfuture Count未満のSnapshot → 補充されて保存される", async () => {
    const { db, env } = setup();
    seedStore(db, {
      mutate: (store) => {
        const last = store
          .listCycles(OWNER_ID)
          .filter((c) => c.status === "upcoming")
          .at(-1)!;
        store.cycles.delete(last.id);
      },
    });
    const before = await reload(db);
    expect(before.store.listCycles(OWNER_ID).filter((c) => c.status === "upcoming")).toHaveLength(
      2,
    );
    vi.setSystemTime(T0 + DAY);

    const result = await runScheduledCycles(env);

    expect(result).toMatchObject({ processed: 0, persisted: true });
    const after = await reload(db);
    expect(after.version).toBe(2);
    expect(after.store.listCycles(OWNER_ID).filter((c) => c.status === "upcoming")).toHaveLength(3);
  });

  it("[代表値] Snapshot行が無いOwner → Cycle 1(Active)が作られて保存される", async () => {
    const { db, env } = setup();
    db.users.set(OWNER_ID, OWNER_EMAIL);

    const result = await runScheduledCycles(env);

    expect(result).toMatchObject({ outcome: "completed", persisted: true, attempts: 1 });
    const after = await reload(db);
    expect(after.version).toBe(1);
    expect(cycleByNumber(after.store, 1)?.status).toBe("active");
  });

  it("[状態遷移] Lease有効なRunを持つSnapshot → skipped run_in_progress、version不変", async () => {
    const { db, env } = setup();
    seedStore(db, {
      mutate: (store, setClock) => {
        setClock(AFTER_CYCLE_1);
        store.startRun(OWNER_ID, { kind: "maintenance", idempotencyKey: "run" });
      },
    });
    vi.setSystemTime(AFTER_CYCLE_1 + 10_000);

    const result = await runScheduledCycles(env);

    expect(result).toEqual({ outcome: "skipped", reason: "run_in_progress" });
    const after = await reload(db);
    expect(after.version).toBe(1);
    expect(cycleByNumber(after.store, 1)?.status).toBe("active");
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "scheduled_cycles", outcome: "skipped", reason: "run_in_progress" }),
    );
  });

  it("[状態遷移] Lease切れのRunを持つSnapshot → Runがpaused・Lockがidleで保存され、Cycle処理も反映", async () => {
    const { db, env } = setup();
    seedStore(db, {
      mutate: (store, setClock) => {
        setClock(AFTER_CYCLE_1);
        store.startRun(OWNER_ID, { kind: "maintenance", idempotencyKey: "run" });
      },
    });
    vi.setSystemTime(AFTER_CYCLE_1 + 31_000);

    const result = await runScheduledCycles(env);

    expect(result).toMatchObject({ outcome: "completed", persisted: true });
    const after = await reload(db);
    expect([...after.store.runs.values()].map((run) => run.status)).toEqual(["paused"]);
    expect(after.store.locks.get(OWNER_ID)).toMatchObject({ status: "idle", runId: null });
    expect(cycleByNumber(after.store, 1)?.status).toBe("completed");
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ])("[境界値] 保存の競合が%d回 → attempts %d。終了は1回分だけ", async (conflicts, attempts) => {
    const { db, env } = setup();
    seedStore(db, {
      mutate: (store) => {
        const unstarted = store
          .ownedWorkflowStates(OWNER_ID)
          .find((s) => s.category === "unstarted")!;
        store.createIssue(OWNER_ID, {
          idempotencyKey: "issue",
          title: SECRET_TITLE,
          cycleId: cycleByNumber(store, 1)!.id,
          statusId: unstarted.id,
        });
      },
    });
    vi.setSystemTime(AFTER_CYCLE_1);
    db.conflictsBeforeSuccess = conflicts;

    const result = await runScheduledCycles(env);

    expect(result).toMatchObject({ outcome: "completed", persisted: true, attempts });
    const after = await reload(db);
    expect(after.version).toBe(1 + conflicts + 1);
    expect(cycleByNumber(after.store, 1)?.status).toBe("completed");
    expect(after.store.cycleHistory).toHaveLength(1);
    expect(after.store.outbox.filter((event) => event.type === "cycle.completed")).toHaveLength(1);
  });

  it("[境界値] 保存の競合が3回 → 例外。D1は競合相手が保存した内容のまま", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);
    db.conflictsBeforeSuccess = 3;

    await expect(runScheduledCycles(env)).rejects.toMatchObject({ code: "D1_WRITE_CONFLICT" });

    const after = await reload(db);
    expect(after.version).toBe(4);
    expect(after.updatedAt).toBe(COMPETITOR_MARK);
    expect(cycleByNumber(after.store, 1)?.status).toBe("active");
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("[代表値] 保存が競合以外の例外を投げる → 再試行せず1回で再送出、D1は不変", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);
    db.failWrites = true;

    await expect(runScheduledCycles(env)).rejects.toThrow("d1 down");

    expect(db.writes).toBe(1);
    const after = await reload(db);
    expect(after.version).toBe(1);
    expect(cycleByNumber(after.store, 1)?.status).toBe("active");
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("[代表値] Cycle処理が例外を投げる → 再送出・version不変・console.errorは3キーだけ", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);
    vi.spyOn(OrbitStore.prototype, "runScheduledCycleTransitions").mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(runScheduledCycles(env)).rejects.toThrow("boom");

    expect((await reload(db)).version).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(vi.mocked(console.error).mock.calls[0][0] as string);
    expect(logged).toEqual({ event: "scheduled_cycles", outcome: "failed", message: "boom" });
  });

  it("[代表値] Errorでない例外のmessageはunknown", async () => {
    const { db, env } = setup();
    seedStore(db);
    vi.spyOn(OrbitStore.prototype, "runScheduledCycleTransitions").mockImplementation(() => {
      throw "plain string with secret";
    });

    await expect(runScheduledCycles(env)).rejects.toBe("plain string with secret");

    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0] as string)).toEqual({
      event: "scheduled_cycles",
      outcome: "failed",
      message: "unknown",
    });
  });

  it("[代表値] 成功・失敗どちらのログにもOWNER_EMAILの値とIssueタイトルが含まれない", async () => {
    const { db, env } = setup();
    seedStore(db, {
      mutate: (store) => {
        const unstarted = store
          .ownedWorkflowStates(OWNER_ID)
          .find((s) => s.category === "unstarted")!;
        store.createIssue(OWNER_ID, {
          idempotencyKey: "issue",
          title: SECRET_TITLE,
          cycleId: cycleByNumber(store, 1)!.id,
          statusId: unstarted.id,
        });
      },
    });
    vi.setSystemTime(AFTER_CYCLE_1);
    await runScheduledCycles(env);
    db.conflictsBeforeSuccess = 3;
    seedStore(db, { mutate: () => {} });
    vi.setSystemTime(AFTER_CYCLE_1);
    await expect(runScheduledCycles(env)).rejects.toBeDefined();

    const output = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
      .flat()
      .join("\n");
    expect(output).toContain("scheduled_cycles");
    for (const secret of [OWNER_EMAIL, OWNER_EMAIL.toLowerCase(), OWNER_ID, SECRET_TITLE])
      expect(output).not.toContain(secret);
  });

  describe("[デシジョンテーブル] Owner解決", () => {
    type Case = {
      name: string;
      envFor: (db: OwnerSnapshotD1) => RuntimeEnvironment;
      users?: [string, string] | null;
      expected: "processed" | "throws" | "memory";
      reads?: 0;
      userId?: string;
      email?: string;
    };
    const cases: Case[] = [
      {
        name: "production 全設定あり email一致",
        envFor: (db) => production(db),
        expected: "processed",
      },
      {
        name: "production OWNER_USER_IDなし",
        envFor: (db) => production(db, { OWNER_USER_ID: undefined }),
        expected: "throws",
        reads: 0,
      },
      {
        name: "production OWNER_EMAILなし",
        envFor: (db) => production(db, { OWNER_EMAIL: undefined }),
        expected: "throws",
        reads: 0,
      },
      {
        name: "production DBなし",
        envFor: (db) => production(db, { DB: undefined }),
        expected: "throws",
      },
      {
        name: "production usersに行なし",
        envFor: (db) => production(db),
        users: null,
        expected: "throws",
        reads: 0,
      },
      {
        name: "production email不一致",
        envFor: (db) => production(db),
        users: [OWNER_ID, "other@example.com"],
        expected: "throws",
        reads: 0,
      },
      {
        name: "production 大文字小文字だけ違う",
        envFor: (db) => production(db),
        users: [OWNER_ID, OWNER_EMAIL.toUpperCase()],
        expected: "processed",
      },
      {
        name: "local local-owner行あり",
        envFor: (db) =>
          ({
            APP_ENV: "local",
            ORBIT_STORAGE: "d1",
            DB: db as unknown as D1Database,
          }) as unknown as RuntimeEnvironment,
        expected: "processed",
        userId: "local-owner",
        email: "local-owner@orbit.local",
      },
      {
        name: "local DBなし",
        envFor: () => ({ APP_ENV: "local", ORBIT_STORAGE: "d1" }),
        expected: "throws",
      },
      {
        name: "development",
        envFor: () => ({ APP_ENV: "development" }),
        expected: "memory",
      },
      {
        name: "production + ORBIT_STORAGE=memory",
        envFor: (db) => production(db, { ORBIT_STORAGE: "memory" }),
        expected: "throws",
        reads: 0,
      },
    ];

    it.each(cases)("$name", async (testCase) => {
      const db = new OwnerSnapshotD1();
      const userId = testCase.userId ?? OWNER_ID;
      const email = testCase.email ?? OWNER_EMAIL;
      seedStore(db, { userId, email });
      if (testCase.users === null) db.users.clear();
      else if (testCase.users) {
        db.users.clear();
        db.users.set(testCase.users[0], testCase.users[1]);
      }
      vi.setSystemTime(AFTER_CYCLE_1);
      const env = testCase.envFor(db);

      if (testCase.expected === "memory") {
        await expect(runScheduledCycles(env)).resolves.toEqual({
          outcome: "skipped",
          reason: "memory_storage",
        });
        return;
      }
      if (testCase.expected === "throws") {
        await expect(runScheduledCycles(env)).rejects.toBeInstanceOf(Error);
        if (testCase.reads === 0) expect(db.snapshotReads).toBe(0);
        expect((await reload(db, userId)).version).toBe(1);
        expect(console.error).toHaveBeenCalledTimes(1);
        return;
      }
      await expect(runScheduledCycles(env)).resolves.toMatchObject({
        outcome: "completed",
        persisted: true,
      });
      expect((await reload(db, userId)).version).toBe(2);
    });

    it.each([
      ["OWNER_USER_ID", { OWNER_USER_ID: undefined }, "Owner is not configured"],
      ["DB", { DB: undefined }, "D1 binding is missing"],
    ])("Owner解決の例外messageは固定文言（%s）", async (_label, extra, message) => {
      const db = new OwnerSnapshotD1();
      seedStore(db);
      await expect(runScheduledCycles(production(db, extra))).rejects.toThrow(message);
    });

    it("Owner行なしのmessageは固定文言で値を含まない", async () => {
      const db = new OwnerSnapshotD1();
      seedStore(db);
      db.users.clear();
      const error = await runScheduledCycles(production(db)).catch((caught: Error) => caught);
      expect((error as Error).message).toBe("Owner was not found");
    });
  });

  it("[代表値] Access JWT関連のenv(ACCESS_TEAM_DOMAIN / ACCESS_AUD)が無くても処理できる", async () => {
    const { db } = setup();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);
    const env = production(db);
    expect(env.ACCESS_TEAM_DOMAIN).toBeUndefined();
    expect(env.ACCESS_AUD).toBeUndefined();

    await expect(runScheduledCycles(env)).resolves.toMatchObject({ persisted: true });
  });
});
