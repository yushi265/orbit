import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { encodeStoreSnapshot } from "./store-snapshot-compat";
import { OrbitStore, type CreateIssueInput } from "./store";
import { buildDailyDigest, runDailyDigest, type DailyDigestEnv } from "./daily-digest";

// 2026-11-25 22:30 UTC = 2026-11-26 07:30 JST (Thu)
const NOW = Date.UTC(2026, 10, 25, 22, 30);
const APP_URL = "https://orbit.example.test";
const day = (month: number, date: number) => Date.UTC(2026, month - 1, date);

function setup() {
  const store = new OrbitStore(() => NOW);
  store.ensureOwner("owner", "owner@example.com");
  store.ensureUpcomingCycles("owner");
  const states = store.ownedWorkflowStates("owner");
  const state = (category: string) => states.find((item) => item.category === category)!.id;
  const cycles = store.listCycles("owner");
  const active = cycles.find((cycle) => cycle.status === "active")!;
  const upcoming = cycles.find((cycle) => cycle.status === "upcoming")!;
  let key = 0;
  const issue = (input: Omit<CreateIssueInput, "idempotencyKey">) =>
    store.createIssue("owner", { idempotencyKey: `digest-${++key}`, ...input });
  return { store, state, active, upcoming, issue };
}

describe("buildDailyDigest", () => {
  it("[デシジョンテーブル] 状態・期限・Cycle・削除/アーカイブから1Issue1区分に振り分ける", () => {
    const { store, state, active, upcoming, issue } = setup();
    const overdue = issue({ title: "期限切れ", dueAt: day(11, 25), cycleId: active.id });
    const today = issue({ title: "今日", dueAt: day(11, 26), cycleId: active.id });
    const cycleOnly = issue({ title: "Cycleだけ", dueAt: day(11, 27), cycleId: active.id });
    const startedCycle = issue({ title: "着手中", statusId: state("started"), cycleId: active.id });
    const backlogOverdue = issue({
      title: "Backlog期限切れ",
      statusId: state("backlog"),
      dueAt: day(11, 1),
    });
    issue({
      title: "除外-完了",
      statusId: state("completed"),
      dueAt: day(11, 20),
      cycleId: active.id,
    });
    issue({
      title: "除外-取消",
      statusId: state("canceled"),
      dueAt: day(11, 26),
      cycleId: active.id,
    });
    issue({ title: "除外-未来Cycle", cycleId: upcoming.id });
    issue({ title: "除外-期限なしCycleなし" });
    issue({ title: "除外-明日", dueAt: day(11, 27) });
    const archived = issue({ title: "除外-アーカイブ", dueAt: day(11, 20) });
    store.archiveIssue("owner", archived.id, "digest-archive");
    const trashed = issue({ title: "除外-削除", dueAt: day(11, 26) });
    store.trashIssue("owner", trashed.id, "digest-trash");

    const digest = buildDailyDigest(store, "owner", NOW, APP_URL)!;

    expect(digest.counts).toEqual({ overdue: 2, today: 1, cycle: 2 });
    const text = digest.text;
    const section = (heading: string) =>
      text.split("■ ").find((part) => part.startsWith(heading)) ?? "";
    expect(section("期限切れ")).toContain(overdue.identifier);
    expect(section("期限切れ")).toContain(backlogOverdue.identifier);
    expect(section("今日期限")).toContain(today.identifier);
    expect(section(`${active.name} の未完了`)).toContain(cycleOnly.identifier);
    expect(section(`${active.name} の未完了`)).toContain(startedCycle.identifier);
    expect(section(`${active.name} の未完了`)).not.toContain(overdue.identifier);
    expect(text).not.toContain("除外-");
  });

  it("[境界値] JSTの今日はUTC日付の翌日として判定する", () => {
    const { store, issue } = setup();
    issue({ title: "UTC今日", dueAt: day(11, 25) });
    issue({ title: "JST今日", dueAt: day(11, 26) });

    const digest = buildDailyDigest(store, "owner", NOW, APP_URL)!;
    expect(digest.counts).toEqual({ overdue: 1, today: 1, cycle: 0 });
    expect(digest.subject).toBe("orbit 11/26(木) 期限切れ1・今日1・Cycle0");
  });

  it.each([APP_URL, `${APP_URL}/`])(
    "[代表値] 本文に識別子・タイトル・期限・URLを並べ、URL %s を末尾/なしで連結する",
    (appUrl) => {
      const { store, issue } = setup();
      const overdue = issue({ title: "請求書を送る", dueAt: day(11, 24) });

      const text = buildDailyDigest(store, "owner", NOW, appUrl)!.text;
      expect(text).toContain("■ 期限切れ（1）");
      expect(text).toContain(
        `- ${overdue.identifier} 請求書を送る（期限 11/24）\n  ${APP_URL}/issues/${overdue.id}`,
      );
      expect(text).not.toContain("■ 今日期限");
      expect(text.trimEnd().endsWith(`${APP_URL}/`)).toBe(true);
      expect(text).not.toContain(`${APP_URL}//`);
    },
  );

  it("[代表値] 期限日昇順→priority順で並べる", () => {
    const { store, issue } = setup();
    const low = issue({ title: "low", dueAt: day(11, 20), priority: "low" });
    const urgent = issue({ title: "urgent", dueAt: day(11, 20), priority: "urgent" });
    const older = issue({ title: "older", dueAt: day(11, 10), priority: "no_priority" });

    const text = buildDailyDigest(store, "owner", NOW, APP_URL)!.text;
    const order = [older, urgent, low].map((item) => text.indexOf(`- ${item.identifier} `));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each([
    [19, 19, false],
    [20, 20, false],
    [21, 20, true],
  ])("[境界値] 1区分%i件なら%i件を並べ、超過分をまとめる=%s", (total, listed, summarized) => {
    const { store, issue } = setup();
    for (let index = 0; index < total; index += 1)
      issue({ title: `Issue ${index}`, dueAt: day(11, 26) });

    const text = buildDailyDigest(store, "owner", NOW, APP_URL)!.text;
    expect(text.match(/^- TASK-/gm)).toHaveLength(listed);
    expect(text.includes("- ほか1件")).toBe(summarized);
  });

  it("[代表値] 該当0件ならnullを返す", () => {
    const { store, issue } = setup();
    issue({ title: "期限なし" });
    expect(buildDailyDigest(store, "owner", NOW, APP_URL)).toBeNull();
  });
});

class DigestD1 {
  readonly queries: string[] = [];
  constructor(private readonly rows: Map<string, string>) {}

  prepare(query: string) {
    this.queries.push(query);
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      all: async () => ({ results: [...this.rows.keys()].map((userId) => ({ userId })) }),
      first: async () => {
        const stateJson = this.rows.get(String(values[0]));
        return stateJson ? { version: 1, stateJson, updatedAt: NOW } : null;
      },
      run: async () => {
        throw new Error("write is not allowed");
      },
    };
    return statement;
  }
}

function digestEnv(overrides: Partial<DailyDigestEnv> = {}, userIds = ["owner"]) {
  const { store, issue } = setup();
  issue({ title: "秘密のタイトル", dueAt: day(11, 26) });
  const json = JSON.stringify(encodeStoreSnapshot(store.toSnapshot()));
  const database = new DigestD1(new Map(userIds.map((userId) => [userId, json])));
  const send = vi.fn(async () => ({ messageId: "message-1" }));
  const env: DailyDigestEnv = {
    DB: database as unknown as D1Database,
    EMAIL: { send },
    ORBIT_DIGEST_FROM: "orbit@example.test",
    ORBIT_DIGEST_TO: "me@example.test",
    ORBIT_APP_URL: APP_URL,
    ...overrides,
  };
  const lines: string[] = [];
  return { env, send, database, lines, log: (line: string) => lines.push(line) };
}

describe("runDailyDigest", () => {
  it("[代表値] snapshotが1件なら送信し、D1へ書き込まない", async () => {
    const { env, send, database, lines, log } = digestEnv();

    const result = await runDailyDigest(env, NOW, log);

    expect(result).toEqual({ status: "sent", counts: { overdue: 0, today: 1, cycle: 0 } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "orbit@example.test",
        to: "me@example.test",
        subject: "orbit 11/26(木) 期限切れ0・今日1・Cycle0",
        text: expect.stringContaining("秘密のタイトル"),
      }),
    );
    expect(database.queries.every((query) => query.trimStart().startsWith("SELECT"))).toBe(true);
    expect(lines).toEqual(["daily-digest sent: overdue=0 today=1 cycle=0"]);
  });

  it.each(["DB", "EMAIL", "ORBIT_DIGEST_FROM", "ORBIT_DIGEST_TO", "ORBIT_APP_URL"] as const)(
    "[異常系] %s が無ければ送らずキー名だけをログに出す",
    async (key) => {
      const { env, send, lines, log } = digestEnv({ [key]: undefined });

      const result = await runDailyDigest(env, NOW, log);

      expect(result).toEqual({ status: "skipped", reason: "missing-config" });
      expect(send).not.toHaveBeenCalled();
      expect(lines).toEqual([`daily-digest skipped: missing-config: ${key}`]);
    },
  );

  it.each([
    ["0件", []],
    ["2件", ["owner", "other"]],
  ])("[境界値] snapshotが%sなら送らない", async (_label, userIds) => {
    const { env, send, lines, log } = digestEnv({}, userIds);

    expect(await runDailyDigest(env, NOW, log)).toEqual({
      status: "skipped",
      reason: "snapshot-count",
    });
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual([`daily-digest skipped: snapshot-count=${userIds.length}`]);
  });

  it("[異常系] 一覧取得後にsnapshotが読めなければ送らない", async () => {
    const { env, send, lines, log } = digestEnv({
      DB: new DigestD1(new Map([["owner", ""]])) as unknown as D1Database,
    });

    expect(await runDailyDigest(env, NOW, log)).toEqual({
      status: "skipped",
      reason: "snapshot-count",
    });
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual(["daily-digest skipped: snapshot-count=0"]);
  });

  it("[代表値] 該当0件の日は送らない", async () => {
    const empty = new OrbitStore(() => NOW);
    empty.ensureOwner("owner", "owner@example.com");
    const json = JSON.stringify(encodeStoreSnapshot(empty.toSnapshot()));
    const { env, send, lines, log } = digestEnv({
      DB: new DigestD1(new Map([["owner", json]])) as unknown as D1Database,
    });

    expect(await runDailyDigest(env, NOW, log)).toEqual({ status: "skipped", reason: "empty" });
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual(["daily-digest skipped: empty"]);
  });

  it("[異常系] 送信失敗はエラーコードだけをログに出して投げ直す", async () => {
    const failure = Object.assign(new Error("me@example.test is not verified"), {
      code: "E_RECIPIENT_PLAN_RESTRICTED",
    });
    const { env, lines, log } = digestEnv({
      EMAIL: { send: vi.fn(async () => Promise.reject(failure)) },
    });

    await expect(runDailyDigest(env, NOW, log)).rejects.toBe(failure);
    expect(lines).toEqual(["daily-digest send failed: E_RECIPIENT_PLAN_RESTRICTED"]);
    expect(lines.join("\n")).not.toContain("example.test");
    expect(lines.join("\n")).not.toContain("秘密のタイトル");
  });

  it("[異常系] codeの無い送信失敗はunknownとしてログに出す", async () => {
    const { env, lines, log } = digestEnv({
      EMAIL: { send: vi.fn(async () => Promise.reject(new Error("boom"))) },
    });

    await expect(runDailyDigest(env, NOW, log)).rejects.toThrow("boom");
    expect(lines).toEqual(["daily-digest send failed: unknown"]);
  });
});
