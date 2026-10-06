import type { D1Database } from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoreSnapshot } from "../db/repositories/store-snapshot";
import type { CycleMailEnvironment } from "./cycle-mail";
import { runScheduledCycles } from "./scheduled-cycles";
import type { ScheduledCyclesResult } from "./scheduled-cycles";
import { OrbitStore } from "./store";
import { decodeStoreSnapshot, encodeStoreSnapshot } from "./store-snapshot-compat";

// scheduled-cycles.test.ts のFakeを必要分だけ複製している（Rule of Three: 2ファイル目のため共通化しない）。
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 5, 0, 0, 0);
const OWNER_ID = "owner-1";
const OWNER_EMAIL = "owner@example.test";
const MAIL_FROM = "orbit@sender.test";
const AFTER_CYCLE_1 = T0 + 15 * DAY;
const COMPETITOR_MARK = 999;

class OwnerSnapshotD1 {
  readonly rows = new Map<string, { version: number; stateJson: string; updatedAt: number }>();
  readonly users = new Map<string, string>();
  conflictsBeforeSuccess = 0;

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
      first: async () => this.rows.get(String(values[0])) ?? null,
      run: async () => {
        const [userId, version, stateJson, updatedAt, expectedVersion] = values as [
          string,
          number,
          string,
          number,
          number,
        ];
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

type Env = Parameters<typeof runScheduledCycles>[0];
type SendArg = { from: string; to: string; subject: string; text: string };

function environment(
  db: OwnerSnapshotD1,
  send: ((arg: SendArg) => Promise<unknown>) | undefined,
  extra: Record<string, unknown> = {},
): Env {
  const mail: CycleMailEnvironment = send
    ? { EMAIL: { send } as unknown as CycleMailEnvironment["EMAIL"], MAIL_FROM }
    : {};
  return {
    APP_ENV: "production",
    OWNER_USER_ID: OWNER_ID,
    OWNER_EMAIL,
    DB: db as unknown as D1Database,
    ...mail,
    ...extra,
  } as unknown as Env;
}

function seedStore(
  db: OwnerSnapshotD1,
  mutate?: (store: OrbitStore, setClock: (value: number) => void) => void,
) {
  let clock = T0;
  const store = new OrbitStore(() => clock);
  store.ensureOwner(OWNER_ID, OWNER_EMAIL);
  store.ensureUpcomingCycles(OWNER_ID);
  mutate?.(store, (value) => {
    clock = value;
  });
  db.rows.set(OWNER_ID, {
    version: 1,
    stateJson: JSON.stringify(encodeStoreSnapshot(store.toSnapshot())),
    updatedAt: 1,
  });
  db.users.set(OWNER_ID, OWNER_EMAIL);
}

async function reload(db: OwnerSnapshotD1) {
  const row = await readStoreSnapshot(db as unknown as D1Database, OWNER_ID);
  if (!row) throw new Error("snapshot row is missing");
  return {
    version: row.version,
    store: OrbitStore.fromSnapshot(decodeStoreSnapshot(row.snapshot), undefined, OWNER_ID),
  };
}

const cycleByNumber = (store: OrbitStore, number: number) =>
  store.listCycles(OWNER_ID).find((cycle) => cycle.number === number);

/** Cycle 1に繰越対象のIssueを`count`件持たせる。 */
const withIssues = (count: number) => (store: OrbitStore) => {
  const unstarted = store.ownedWorkflowStates(OWNER_ID).find((s) => s.category === "unstarted")!;
  for (let index = 0; index < count; index += 1)
    store.createIssue(OWNER_ID, {
      idempotencyKey: `issue-${index}`,
      title: `Issue ${index}`,
      cycleId: cycleByNumber(store, 1)!.id,
      statusId: unstarted.id,
    });
};

const okSend = () => vi.fn(async (_arg: SendArg) => ({ messageId: "id" }));

describe("runScheduledCycles のメール通知", () => {
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

  it("[代表値] 期限切れActiveを持つSnapshot → sendが1回で from/to/subject が期待どおり、本文に完了の行", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db, withIssues(2));
    const send = okSend();
    vi.setSystemTime(AFTER_CYCLE_1);

    await runScheduledCycles(environment(db, send));

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.from).toBe(MAIL_FROM);
    expect(arg.to).toBe(OWNER_EMAIL);
    expect(arg.subject).toBe("[Orbit] Cycleを更新しました");
    const name = cycleByNumber((await reload(db)).store, 1)!.name;
    expect(arg.text).toContain(`${name} が完了しました（繰越 2 件）`);
  });

  it("[代表値] hasRemainingがtrueの結果 → 本文の最後に残件の行が付く", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    const send = okSend();
    vi.spyOn(OrbitStore.prototype, "runScheduledCycleTransitions").mockReturnValue({
      status: "done",
      processed: 1,
      hasRemaining: true,
      transitions: [{ type: "started", cycleId: "cycle-9", name: "Cycle 9" }],
    });

    await runScheduledCycles(environment(db, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toBe(
      "Cycle 9 を開始しました\n\n未処理のCycleが残っています。次回の自動実行で処理します。",
    );
  });

  it("[代表値] 完了と開始を1回で処理するSnapshot → sendは1回、本文は完了の行、開始の行の順", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db, (store) => {
      cycleByNumber(store, 2)!.startsAt = cycleByNumber(store, 1)!.endsAt;
    });
    const send = okSend();
    vi.setSystemTime(AFTER_CYCLE_1);

    await runScheduledCycles(environment(db, send));

    expect(send).toHaveBeenCalledTimes(1);
    const lines = send.mock.calls[0][0].text.split("\n");
    expect(lines[0]).toMatch(/ が完了しました（繰越 \d+ 件）$/);
    expect(lines[1]).toMatch(/ を開始しました$/);
  });

  it.each([
    ["境界なし", (db: OwnerSnapshotD1) => environment(db, okSend()), undefined],
    [
      "Upcomingの補充だけ保存",
      (db: OwnerSnapshotD1) => environment(db, okSend()),
      (store: OrbitStore) => {
        const last = store
          .listCycles(OWNER_ID)
          .filter((c) => c.status === "upcoming")
          .at(-1)!;
        store.cycles.delete(last.id);
      },
    ],
    [
      "Manual Run実行中(skipped)",
      (db: OwnerSnapshotD1) => environment(db, okSend()),
      (store: OrbitStore, setClock?: (value: number) => void) => {
        setClock?.(AFTER_CYCLE_1);
        store.startRun(OWNER_ID, { kind: "maintenance", idempotencyKey: "run" });
      },
    ],
    [
      "Memory Store(skipped)",
      (db: OwnerSnapshotD1) =>
        environment(db, okSend(), {
          APP_ENV: "development",
          OWNER_USER_ID: undefined,
          OWNER_EMAIL: undefined,
        }),
      undefined,
    ],
  ])("[同値分割] %s → sendを呼ばない", async (label, makeEnv, mutate) => {
    const db = new OwnerSnapshotD1();
    seedStore(db, mutate);
    const send = okSend();
    const env = makeEnv(db);
    (env as unknown as { EMAIL: { send: unknown } }).EMAIL = { send };
    vi.setSystemTime(label.startsWith("Manual") ? AFTER_CYCLE_1 + 10_000 : T0 + DAY);

    await runScheduledCycles(env);

    expect(send).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])(
    "[境界値] 保存の競合が%d回 → sendは1回だけ。本文は再読込したD1の内容と一致",
    async (conflicts) => {
      const db = new OwnerSnapshotD1();
      seedStore(db, withIssues(3));
      const send = okSend();
      vi.setSystemTime(AFTER_CYCLE_1);
      db.conflictsBeforeSuccess = conflicts;

      await runScheduledCycles(environment(db, send));

      expect(send).toHaveBeenCalledTimes(1);
      const after = await reload(db);
      const name = cycleByNumber(after.store, 1)!.name;
      const moved = after.store.outbox.find((e) => e.type === "cycle.completed")!.payload.moved;
      expect(moved).toBe(3);
      expect(send.mock.calls[0][0].text).toContain(`${name} が完了しました（繰越 ${moved} 件）`);
      expect(send.mock.calls[0][0].subject).toBe("[Orbit] Cycleを更新しました");
    },
  );

  it("[境界値] 保存の競合が3回 → sendは1回で件名が失敗のもの。例外はD1_WRITE_CONFLICT", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    const send = okSend();
    vi.setSystemTime(AFTER_CYCLE_1);
    db.conflictsBeforeSuccess = 3;

    const error = await runScheduledCycles(environment(db, send)).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "D1_WRITE_CONFLICT" });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.subject).toBe("[Orbit] Cycleの自動処理に失敗しました");
    expect(arg.text).toContain(`原因: ${(error as Error).message}`);
  });

  it("[代表値] Cycle処理が例外 → 失敗メール1通（本文にmessage）、同じ例外が再送出、既存の失敗ログは3キーのまま", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    const send = okSend();
    vi.setSystemTime(AFTER_CYCLE_1);
    const thrown = new Error("boom");
    vi.spyOn(OrbitStore.prototype, "runScheduledCycleTransitions").mockImplementation(() => {
      throw thrown;
    });

    await expect(runScheduledCycles(environment(db, send))).rejects.toBe(thrown);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe("[Orbit] Cycleの自動処理に失敗しました");
    expect(send.mock.calls[0][0].text).toContain("原因: boom");
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe(
      JSON.stringify({ event: "scheduled_cycles", outcome: "failed", message: "boom" }),
    );
  });

  it("[代表値] 送信は保存のあと: sendが呼ばれた時点で、D1のversionが進んでいる", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    let versionAtSend: number | undefined;
    const send = vi.fn(async (_arg: SendArg) => {
      versionAtSend = db.rows.get(OWNER_ID)?.version;
      return {};
    });
    vi.setSystemTime(AFTER_CYCLE_1);

    await runScheduledCycles(environment(db, send));

    expect(versionAtSend).toBe(2);
  });

  it("[代表値] EMAIL bindingなし → 戻り値とD1の内容はbindingありと同じ。cycle_mail / not_configuredのログ", async () => {
    const withMail = new OwnerSnapshotD1();
    const without = new OwnerSnapshotD1();
    seedStore(withMail);
    seedStore(without);
    vi.setSystemTime(AFTER_CYCLE_1);

    const expected = await runScheduledCycles(environment(withMail, okSend()));
    vi.mocked(console.log).mockClear();
    const actual = await runScheduledCycles(environment(without, undefined));

    expect(actual).toEqual(expected);
    const summary = async (target: OwnerSnapshotD1) => {
      const { version, store } = await reload(target);
      return {
        version,
        cycles: store.listCycles(OWNER_ID).map((c) => [c.number, c.status]),
        history: store.cycleHistory.length,
        outbox: store.outbox.map((e) => e.type),
      };
    };
    expect(await summary(without)).toEqual(await summary(withMail));
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "cycle_mail", outcome: "not_configured" }),
    );
  });

  it("[代表値] sendが例外 → 戻り値はcompleted、D1は保存済み、例外は外へ出ない", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    const send = vi.fn(async (_arg: SendArg) => {
      throw Object.assign(new Error("smtp down"), { code: "E_DOWN" });
    });
    vi.setSystemTime(AFTER_CYCLE_1);

    const result = await runScheduledCycles(environment(db, send));

    expect(result).toMatchObject({ outcome: "completed", persisted: true });
    const after = await reload(db);
    expect(after.version).toBe(2);
    expect(cycleByNumber(after.store, 1)?.status).toBe("completed");
    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify({ event: "cycle_mail", outcome: "failed", code: "E_DOWN" }),
    );
  });

  it("[代表値] Cycle処理が例外で、失敗メールのsendも例外 → 再送出されるのはCycle処理の例外", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    const send = vi.fn(async (_arg: SendArg) => {
      throw new Error("send failed");
    });
    const thrown = new Error("boom");
    vi.spyOn(OrbitStore.prototype, "runScheduledCycleTransitions").mockImplementation(() => {
      throw thrown;
    });

    await expect(runScheduledCycles(environment(db, send))).rejects.toBe(thrown);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("[代表値] Owner未設定（OWNER_EMAILなし）で失敗 → sendを呼ばず、元の例外を再送出", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    const send = okSend();
    const env = environment(db, send);
    delete (env as Record<string, unknown>).OWNER_EMAIL;

    await expect(runScheduledCycles(env)).rejects.toThrow("Owner is not configured");

    expect(send).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "cycle_mail", outcome: "not_configured" }),
    );
  });

  it("[代表値] scheduled_cyclesのログのキーとScheduledCyclesResultの形が変わらない", async () => {
    const db = new OwnerSnapshotD1();
    seedStore(db);
    vi.setSystemTime(AFTER_CYCLE_1);

    const result: ScheduledCyclesResult = await runScheduledCycles(environment(db, okSend()));

    expect(Object.keys(result).sort()).toEqual([
      "attempts",
      "hasRemaining",
      "outcome",
      "persisted",
      "processed",
    ]);
    const line = vi
      .mocked(console.log)
      .mock.calls.map(([text]) => JSON.parse(String(text)))
      .find((entry) => entry.event === "scheduled_cycles");
    expect(Object.keys(line).sort()).toEqual([
      "attempts",
      "event",
      "hasRemaining",
      "outcome",
      "persisted",
      "processed",
    ]);
  });
});
