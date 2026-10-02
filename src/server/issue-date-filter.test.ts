import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesIssueDueDate } from "../shared/issue-dates";
import { listIssues, searchIssues } from "./api";
import { getOrbitStore, OrbitStore, resetOrbitStores } from "./store";

function setup(now: number, timezone = "Asia/Tokyo") {
  const store = new OrbitStore(() => now);
  store.ensureOwner("owner", "owner@example.com");
  store.updatePreferences("owner", { timezone }, "owner-timezone");
  return store;
}

describe("Issue date-only filters", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetOrbitStores();
  });

  it("[境界値] 東京01時のtodayはサーバーUTCの前日ではなく本人の暦日になる", () => {
    vi.stubEnv("TZ", "UTC");
    const store = setup(Date.UTC(2026, 9, 1, 16));
    store.createIssue("owner", {
      idempotencyKey: "yesterday",
      title: "Yesterday",
      dueAt: Date.UTC(2026, 9, 1),
    });
    store.createIssue("owner", {
      idempotencyKey: "today",
      title: "Today",
      dueAt: Date.UTC(2026, 9, 2),
    });

    expect(
      store.listIssues("owner", { filter: { due: "today" } }).map((issue) => issue.title),
    ).toEqual(["Today"]);
  });

  it("[デシジョンテーブル] UTC暦日でnone・overdue・today・upcomingを判定し検索にも同じ条件を使う", () => {
    vi.stubEnv("TZ", "UTC");
    const store = setup(Date.UTC(2026, 9, 1, 16));
    for (const [key, dueAt] of [
      ["Yesterday", Date.UTC(2026, 9, 1, 23, 59)],
      ["Today", Date.UTC(2026, 9, 2, 23, 59)],
      ["Upcoming", Date.UTC(2026, 9, 3)],
      ["None", null],
    ] as const)
      store.createIssue("owner", { idempotencyKey: key, title: `Date ${key}`, dueAt });
    for (const [due, title] of [
      ["none", "Date None"],
      ["overdue", "Date Yesterday"],
      ["today", "Date Today"],
      ["upcoming", "Date Upcoming"],
    ] as const) {
      expect(store.listIssues("owner", { filter: { due } }).map((issue) => issue.title)).toEqual([
        title,
      ]);
      expect(
        store.search("owner", "Date", { filter: { due } }).map((issue) => issue.title),
      ).toEqual([title]);
    }
  });

  it("[状態遷移] 東京からLA・UTCへ変更しても既存non-midnight期限値を保存し直さない", () => {
    const now = Date.UTC(2026, 9, 1, 16);
    const store = setup(now);
    const october1 = store.createIssue("owner", {
      idempotencyKey: "october-1",
      title: "October 1",
      dueAt: Date.UTC(2026, 9, 1),
    });
    const october2 = store.createIssue("owner", {
      idempotencyKey: "october-2",
      title: "October 2",
      dueAt: Date.UTC(2026, 9, 2, 23, 45),
    });
    const before = store.toSnapshot().issues;
    expect(
      store.listIssues("owner", { filter: { due: "today" } }).map((issue) => issue.id),
    ).toEqual([october2.id]);
    for (const timezone of ["America/Los_Angeles", "UTC"]) {
      store.updatePreferences("owner", { timezone }, `change-${timezone}`);
      expect(
        store.listIssues("owner", { filter: { due: "today" } }).map((issue) => issue.id),
      ).toEqual([october1.id]);
      expect(
        store.listIssues("owner", { filter: { due: "upcoming" } }).map((issue) => issue.id),
      ).toEqual([october2.id]);
      expect(store.toSnapshot().issues).toEqual(before);
      const restored = OrbitStore.fromSnapshot(store.toSnapshot(), () => now, "owner");
      expect(restored.getIssue("owner", october2.id).dueAt).toBe(Date.UTC(2026, 9, 2, 23, 45));
    }
  });

  it.each([
    ["2026-03-08T09:59:59Z", 2, 8],
    ["2026-03-08T10:00:00Z", 2, 8],
    ["2026-03-09T06:59:59Z", 2, 8],
    ["2026-03-09T07:00:00Z", 2, 9],
    ["2026-11-01T08:59:59Z", 10, 1],
    ["2026-11-01T09:00:00Z", 10, 1],
    ["2026-11-02T07:59:59Z", 10, 1],
    ["2026-11-02T08:00:00Z", 10, 2],
  ] as const)("[境界値] LAのDST・日付境界 %s のtodayは本人の暦日になる", (value, month, day) => {
    vi.stubEnv("TZ", "UTC");
    const store = setup(Date.parse(value), "America/Los_Angeles");
    const dueAt = Date.UTC(2026, month, day);
    store.createIssue("owner", {
      idempotencyKey: "dst-yesterday",
      title: "Yesterday",
      dueAt: dueAt - 24 * 60 * 60 * 1000,
    });
    store.createIssue("owner", { idempotencyKey: "dst-today", title: "Today", dueAt });
    store.createIssue("owner", {
      idempotencyKey: "dst-tomorrow",
      title: "Tomorrow",
      dueAt: dueAt + 24 * 60 * 60 * 1000,
    });

    expect(
      store.listIssues("owner", { filter: { due: "today" } }).map((issue) => issue.title),
    ).toEqual(["Today"]);
    expect(
      store.listIssues("owner", { filter: { due: "overdue" } }).map((issue) => issue.title),
    ).toEqual(["Yesterday"]);
    expect(
      store.listIssues("owner", { filter: { due: "upcoming" } }).map((issue) => issue.title),
    ).toEqual(["Tomorrow"]);
  });

  it("[セキュリティ境界] 日付Filterは指定scopeとOwnerの分離を維持する", () => {
    const store = setup(Date.UTC(2026, 9, 1, 16));
    const active = store.createIssue("owner", {
      idempotencyKey: "active",
      title: "Active",
      dueAt: Date.UTC(2026, 9, 2),
    });
    const archived = store.createIssue("owner", {
      idempotencyKey: "archived",
      title: "Archived",
      dueAt: Date.UTC(2026, 9, 2),
    });
    const trash = store.createIssue("owner", {
      idempotencyKey: "trash",
      title: "Trash",
      dueAt: Date.UTC(2026, 9, 2),
    });
    store.archiveIssue("owner", archived.id, "archive-owner");
    store.trashIssue("owner", trash.id, "trash-owner");
    store.ensureOwner("other", "other@example.com");
    store.createIssue("other", {
      idempotencyKey: "foreign",
      title: "Foreign",
      dueAt: Date.UTC(2026, 9, 2),
    });

    expect(
      store.listIssues("owner", { filter: { due: "today" } }).map((issue) => issue.id),
    ).toEqual([active.id]);
    expect(
      store.listIssues("owner", { filter: { due: "today" } }, "archived").map((issue) => issue.id),
    ).toEqual([archived.id]);
    expect(
      store.listIssues("owner", { filter: { due: "today" } }, "trash").map((issue) => issue.id),
    ).toEqual([trash.id]);
    expect(store.search("owner", "Foreign", { filter: { due: "today" } })).toEqual([]);
  });

  it.each(["Asia/Tokyo", "America/Los_Angeles", "UTC"])(
    "[レイヤー内結合] %sの検索/List APIとUI共有判定が一致する",
    async (timezone) => {
      const now = Date.UTC(2026, 9, 1, 16);
      vi.stubEnv("APP_ENV", "development");
      vi.stubEnv("ORBIT_STORAGE", "memory");
      vi.stubEnv("DEV_OWNER_USER_ID", "api-date-owner");
      vi.stubEnv("TZ", "UTC");
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const store = getOrbitStore("api-date-owner");
      store.updatePreferences("api-date-owner", { timezone }, "api-timezone");
      const issues = (
        [
          ["Date October 1", Date.UTC(2026, 9, 1)],
          ["Date October 2", Date.UTC(2026, 9, 2, 23, 45)],
          ["Date October 3", Date.UTC(2026, 9, 3)],
          ["Date None", null],
        ] as const
      ).map(([title, dueAt], index) =>
        store.createIssue("api-date-owner", {
          idempotencyKey: `api-date-${index}`,
          title,
          dueAt,
        }),
      );
      const expected =
        timezone === "Asia/Tokyo"
          ? {
              none: ["Date None"],
              overdue: ["Date October 1"],
              today: ["Date October 2"],
              upcoming: ["Date October 3"],
            }
          : {
              none: ["Date None"],
              overdue: [],
              today: ["Date October 1"],
              upcoming: ["Date October 2", "Date October 3"],
            };
      for (const due of ["none", "overdue", "today", "upcoming"] as const) {
        const list = await listIssues(
          new Request(`http://orbit.local/api/v1/issues?q=Date&due=${due}`),
        );
        const search = await searchIssues(
          new Request(`http://orbit.local/api/v1/search?q=Date&due=${due}`),
        );
        expect(list.status).toBe(200);
        expect(search.status).toBe(200);
        const listed = (await list.json()) as { items: Array<{ title: string }> };
        const searched = (await search.json()) as { items: Array<{ title: string }> };
        expect(listed.items.map((issue) => issue.title)).toEqual(expected[due]);
        expect(searched.items.map((issue) => issue.title)).toEqual(expected[due]);
        expect(
          issues
            .filter((issue) => matchesIssueDueDate(issue.dueAt, due, now, timezone))
            .map((issue) => issue.title),
        ).toEqual(expected[due]);
      }
      expect(store.toSnapshot().issues[1].dueAt).toBe(Date.UTC(2026, 9, 2, 23, 45));
    },
  );
});
