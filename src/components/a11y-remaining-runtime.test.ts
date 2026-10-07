import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleViewModel } from "../shared/view-models";
import { CommandPalette, CyclesView, InboxView, SearchView } from "./OrbitApp";
import { OrbitDatePicker } from "./orbit-date-picker";
import { queryClient } from "../lib/query";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let root: Root;
let app: RenderedApp | undefined;
const doc = () => dom.window.document;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.addEventListener(name.replace(/^on/, ""), handler);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.removeEventListener(name.replace(/^on/, ""), handler);
    },
  });
  root = createRoot(doc().getElementById("root")!);
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const all = (selector: string) => [...doc().querySelectorAll(selector)] as HTMLElement[];
const one = (selector: string) => doc().querySelector(selector) as HTMLElement;
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });

// ---- アプリ全体（実 Router） ----
const issueA = reviewIssue("issue-1", { title: "Alpha", cycleId: "cycle-1" });
type Bootstrap = ReturnType<typeof reviewBootstrap>;
async function openApp(entry: string, bootstrap: Bootstrap = reviewBootstrap([issueA])) {
  await app?.unmount();
  app = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      const body =
        path === "/api/v1/bootstrap"
          ? bootstrap
          : path.startsWith("/api/v1/issues/")
            ? reviewDetail(issueA)
            : { run: null };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const container = doc().createElement("div");
  doc().body.append(container);
  app = await renderApp({ url: entry, container });
  await settle();
}

describe("AC-1 Settings select の名前", () => {
  it.each([
    ["Theme", 0],
    ["Color theme", 1],
    ["Timezone", 2],
    ["Language", 3],
  ])("[代表値] %s の select は見出しを aria-labelledby で参照する", async (heading, index) => {
    await openApp("/settings");
    const select = all(".setting-row select")[index];
    const ids = (select.getAttribute("aria-labelledby") ?? "").split(" ").filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    const text = ids.map((id: string) => doc().getElementById(id)?.textContent ?? "").join(" ");
    expect(text).toBe(heading);
    const label = select.getAttribute("aria-label");
    expect(label === null || label.startsWith(heading)).toBe(true);
  });
});

const searchProps = {
  query: "",
  onQuery: () => undefined,
  results: [],
  onOpen: () => undefined,
  onOpenIssueId: () => undefined,
  searchBusy: false,
  searchError: null,
  onRetry: () => undefined,
  workflowStates: [],
  projects: [],
  cycles: [],
  labels: [],
  filters: {
    statusId: "all",
    priority: "all",
    projectId: "all",
    cycleId: "all",
    labelId: "all",
    due: "all",
  },
  setFilters: () => undefined,
  recentIssueViews: [],
  recentSearches: [],
  modifierLabel: "Ctrl" as const,
};
const renderSearch = (props: Record<string, unknown>) =>
  act(async () => root.render(createElement(SearchView, { ...searchProps, ...props } as never)));

describe("AC-2 検索 status / AC-9 入力名", () => {
  it("[代表値] 検索前から role=status 要素が DOM にある", async () => {
    await renderSearch({});
    expect(all('[role="status"]').length).toBeGreaterThan(0);
  });
  it("[状態遷移] 検索中は status の中に「検索しています…」", async () => {
    await renderSearch({ query: "abc", searchBusy: true });
    expect(all('[role="status"]').some((el) => el.textContent?.includes("検索しています…"))).toBe(
      true,
    );
  });
  it("[状態遷移] 結果が返ると status の中に「N件のIssue」", async () => {
    await renderSearch({ query: "abc", results: [reviewIssue("a"), reviewIssue("b")] });
    expect(all('[role="status"]').some((el) => el.textContent?.includes("2件のIssue"))).toBe(true);
  });
  it("[代表値] 検索ページの入力にアクセシブルな名前がある", async () => {
    await renderSearch({});
    const input = one("#global-search-input");
    expect(input.getAttribute("aria-label") || input.getAttribute("aria-labelledby")).toBeTruthy();
  });
});

const cycle = (overrides: Partial<CycleViewModel>): CycleViewModel => ({
  id: "cycle-1",
  userId: "owner",
  number: 1,
  name: "Cycle 1",
  nameOverride: null,
  description: "",
  startsAt: Date.UTC(2026, 9, 1),
  endsAt: Date.UTC(2026, 9, 14),
  status: "active",
  completedAt: null,
  scheduleOverridden: false,
  ...overrides,
});
const cyclesProps = {
  cycles: [
    cycle({}),
    cycle({ id: "cycle-2", number: 2, status: "upcoming" }),
    cycle({ id: "cycle-0", number: 0, status: "completed", completedAt: 1 }),
  ],
  issues: [issueA],
  workflowStates: reviewBootstrap().workflowStates,
  pendingIssueId: null,
  onUpdateIssue: () => undefined,
  onRefresh: () => undefined,
  onNavigateIssues: () => undefined,
  onNavigateCycles: () => undefined,
  closeBusy: false,
  startBusy: false,
  onClose: () => undefined,
  onStart: async () => false,
};
const renderCycles = () =>
  act(async () => root.render(createElement(CyclesView, cyclesProps as never)));
const tabs = () => all('[role="tablist"] [role="tab"]');

describe("AC-3 Cycle tabs", () => {
  it("[代表値] tablist の中に tab が並び、選択中だけ aria-selected=true と tabIndex=0", async () => {
    await renderCycles();
    expect(tabs()).toHaveLength(3);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });
  it("[状態遷移] ArrowRight で次へ選択・フォーカス、最後から最初へ戻る", async () => {
    await renderCycles();
    tabs()[0].focus();
    await key(tabs()[0], "ArrowRight");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(doc().activeElement).toBe(tabs()[1]);
    await key(tabs()[1], "ArrowRight");
    expect(doc().activeElement).toBe(tabs()[2]);
    await key(tabs()[2], "ArrowRight");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(doc().activeElement).toBe(tabs()[0]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });
  it("[状態遷移] ArrowLeft（先頭から末尾へ）・End・Home", async () => {
    await renderCycles();
    tabs()[0].focus();
    await key(tabs()[0], "ArrowLeft");
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    expect(doc().activeElement).toBe(tabs()[2]);
    await key(tabs()[2], "Home");
    expect(doc().activeElement).toBe(tabs()[0]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    await key(tabs()[0], "End");
    expect(doc().activeElement).toBe(tabs()[2]);
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
  });
});

describe("AC-4 Inbox トグル", () => {
  it("[代表値] role=tab が無く、選択中のボタンだけ aria-pressed=true", async () => {
    await act(async () =>
      root.render(
        createElement(InboxView, {
          notifications: [],
          onOpenNotification: async () => undefined,
          onMarkAllRead: async () => undefined,
          onNavigateIssues: () => undefined,
        }),
      ),
    );
    expect(all('[role="tab"]')).toHaveLength(0);
    const buttons = all(".inbox-filter");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    await act(async () => buttons[1].click());
    expect(all(".inbox-filter").map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
  });
});

describe("AC-8 カレンダーの focusout", () => {
  async function renderPicker() {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(OrbitDatePicker, {
            label: "期限",
            value: "2026-10-05",
            onChange: () => {},
          }),
          createElement("button", { id: "outside" }, "外"),
        ),
      ),
    );
    await act(async () => one(".orbit-calendar-trigger").click());
  }
  it("[状態遷移] フォーカスが外へ移るとカレンダーが閉じる", async () => {
    await renderPicker();
    expect(doc().querySelector(".orbit-calendar")).not.toBeNull();
    one(".orbit-calendar button").focus();
    await act(async () => one("#outside").focus());
    expect(doc().querySelector(".orbit-calendar")).toBeNull();
  });
  it("[状態遷移] カレンダー内でフォーカスが移っても閉じない", async () => {
    await renderPicker();
    const buttons = all(".orbit-calendar button");
    buttons[0].focus();
    await act(async () => buttons[1].focus());
    expect(doc().querySelector(".orbit-calendar")).not.toBeNull();
    await act(async () => one(".orbit-calendar-trigger").focus());
    expect(doc().querySelector(".orbit-calendar")).not.toBeNull();
  });
});

describe("AC-9 名前", () => {
  it("[代表値] Issue 絞り込み入力に名前がある", async () => {
    await openApp("/issues");
    const input = one("#issues-filter-input");
    expect(input.getAttribute("aria-label") || input.getAttribute("aria-labelledby")).toBeTruthy();
  });
  it("[代表値] コマンドパレットの入力と listbox に名前がある", async () => {
    await act(async () =>
      root.render(
        createElement(CommandPalette, {
          onClose: () => undefined,
          onCreate: () => undefined,
          onNavigate: () => undefined,
          onSearch: () => undefined,
          onOpenSelected: () => undefined,
          onArchiveSelected: () => undefined,
          onClearSelection: () => undefined,
          modifierLabel: "Ctrl",
        }),
      ),
    );
    for (const el of [one(".command-input input"), one('[role="listbox"]')])
      expect(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")).toBeTruthy();
  });
});

describe("AC-10 ボタン名・優先度", () => {
  it("[代表値] 「×」だけの button は全て aria-label を持つ（Composer・Modal・メニュー）", async () => {
    await openApp("/issues");
    await act(async () => {
      doc().body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
    });
    expect(doc().querySelector("#issue-composer-title")).not.toBeNull();
    const bare = all("button").filter((b) => b.textContent?.trim() === "×");
    expect(bare.length).toBeGreaterThan(0);
    for (const b of bare) expect(b.getAttribute("aria-label")).toBeTruthy();
  });
  it("[代表値] Modal の × にも aria-label がある", async () => {
    await openApp("/issues");
    await act(async () => {
      doc().body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "?", bubbles: true }),
      );
    });
    const dialog = one('[role="dialog"]');
    expect(dialog.textContent).toContain("キーボードショートカット");
    const bare = [...dialog.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "×",
    );
    expect(bare.length).toBeGreaterThan(0);
    for (const b of bare) expect(b.getAttribute("aria-label")).toBe("閉じる");
  });
  it("[同値分割] 未読 0 件 → 「通知」、未読 3 件 → 「通知（未読3件）」", async () => {
    await openApp("/");
    expect(one(".topbar-actions .icon-button").getAttribute("aria-label")).toBe("通知");
    const unread = (i: number) => ({
      id: `n${i}`,
      userId: "owner",
      type: "due_soon" as const,
      title: `t${i}`,
      body: "",
      entityType: "issue" as const,
      entityId: "issue-1",
      readAt: null,
      deletedAt: null,
      createdAt: 1,
    });
    await openApp("/", {
      ...reviewBootstrap([issueA]),
      notifications: [unread(1), unread(2), unread(3)],
    });
    expect(one(".topbar-actions .icon-button").getAttribute("aria-label")).toBe("通知（未読3件）");
  });
  it("[代表値] Cycle List の行に .priority-dot が無く PriorityIcon がある", async () => {
    await renderCycles();
    expect(doc().querySelector(".priority-dot")).toBeNull();
    const row = one(".cycle-issue-row, .cycle-issue");
    expect(row.querySelector('[role="img"][aria-label]')).not.toBeNull();
  });
});

describe("AC-11 document.title", () => {
  it.each([
    ["/", "Home"],
    ["/issues", "Issues"],
    ["/cycles", "Cycles"],
    ["/projects", "Projects"],
    ["/views", "Views"],
    ["/search", "Search"],
    ["/inbox", "Inbox"],
    ["/settings", "Settings"],
  ])("[同値分割] %s の title は「%s — Orbit」", async (path, label) => {
    await openApp(path);
    expect(doc().title).toBe(`${label} — Orbit`);
  });
  it("[代表値] Issue 詳細は「<識別子> <タイトル> — Orbit」", async () => {
    await openApp("/issues/issue-1");
    expect(doc().title).toBe(`${issueA.identifier} ${issueA.title} — Orbit`);
  });
  it("[異常系] 一覧に無い Issue の詳細は Issues — Orbit", async () => {
    await openApp("/issues/unknown");
    expect(doc().title).toBe("Issues — Orbit");
  });
});

describe("AC-12 非ボタン要素・NavItem", () => {
  it("[代表値] 「OU」とワークスペース切替は button ではない", async () => {
    await openApp("/");
    const ou = all(".avatar");
    expect(ou.length).toBeGreaterThanOrEqual(2);
    for (const el of ou) expect(el.tagName).not.toBe("BUTTON");
    expect(one(".workspace-switcher").tagName).not.toBe("BUTTON");
  });
  it("[代表値] NavItem のアイコン記号は aria-hidden で名前に含まれない", async () => {
    await openApp("/");
    const icons = all(".nav-item .nav-icon");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("AC-13 table roles・スキップリンク", () => {
  it("[代表値] List 表示に table / row / columnheader / cell が付く", async () => {
    await openApp("/issues");
    const table = one(".issue-table");
    expect(table.getAttribute("role")).toBe("table");
    const rows = all('.issue-table [role="row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('[role="columnheader"]').length).toBeGreaterThanOrEqual(5);
    expect(rows[1].querySelectorAll('[role="cell"]').length).toBeGreaterThanOrEqual(5);
    expect(rows[1].querySelector('[role="columnheader"]')).toBeNull();
  });
  it("[代表値] 最初の Tab 可能要素が a.skip-link で、main#main-content がある", async () => {
    await openApp("/");
    const first = doc().querySelector(
      'a[href], button:not([disabled]), input:not([disabled]), select, [tabindex="0"]',
    );
    expect(first?.matches('a.skip-link[href="#main-content"]')).toBe(true);
    expect(first?.textContent).toBe("本文へ移動");
    expect(one("main").id).toBe("main-content");
  });
});
