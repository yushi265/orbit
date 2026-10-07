import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesView } from "./OrbitApp";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { queryClient } from "../lib/query";
import type { BootstrapViewModel, IssueViewModel } from "../shared/view-models";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let app: RenderedApp | undefined;
let data: BootstrapViewModel;
let requests: Array<{ path: string; init: RequestInit }>;
let unexpected: string[];
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  input.dispatchEvent(
    Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
      propertyName: "value",
    }),
  );
}
async function render(url = "/issues") {
  app = await renderApp({ url, container: dom.window.document.getElementById("root")! });
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
async function timezone(value: string) {
  data = { ...data, preferences: { ...data.preferences, timezone: value } };
  await act(async () => queryClient.setQueryData(["bootstrap"], data));
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
function dueInput() {
  return dom.window.document.querySelector('input[type="date"]') as HTMLInputElement;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 2, 14, 59, 20));
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/issues" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
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
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queryClient.clear();
  data = reviewBootstrap([
    reviewIssue("issue-1", { dueAt: Date.UTC(2026, 9, 2) }),
    reviewIssue("issue-2", { dueAt: Date.UTC(2026, 9, 3) }),
  ]);
  requests = [];
  unexpected = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      requests.push({ path, init });
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") return json(data);
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return json({ run: null });
      if (path === "/api/v1/issues/issue-1" && method === "GET")
        return json(reviewDetail(data.issues[0]));
      if (path === "/api/v1/issues/issue-1" && method === "PATCH") {
        const body = JSON.parse(init.body as string);
        const issue = { ...data.issues[0], ...body.patch, version: data.issues[0].version + 1 };
        data = { ...data, issues: [issue, data.issues[1]] };
        return json({ issue });
      }
      if (path === "/api/v1/issues" && method === "POST") {
        const body = JSON.parse(init.body as string);
        const issue = reviewIssue("new-issue", { title: body.title, dueAt: body.dueAt });
        return json({ issue });
      }
      unexpected.push(`${method} ${path}`);
      throw new Error(`Unexpected API request: ${method} ${path}`);
    }),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(unexpected).toEqual([]);
});
function readonlyList(issue: IssueViewModel) {
  return createElement(IssuesView, {
    issues: [issue],
    scope: "trash",
    scopeLoading: false,
    setScope: () => undefined,
    workflowStates: data.workflowStates,
    filterText: "",
    setFilterText: () => undefined,
    priorityFilter: "all",
    setPriorityFilter: () => undefined,
    projectFilter: "all",
    setProjectFilter: () => undefined,
    labelFilter: "all",
    setLabelFilter: () => undefined,
    showCompleted: true,
    setShowCompleted: () => undefined,
    issueSort: "updated_desc",
    setIssueSort: () => undefined,
    projects: [],
    allIssues: [issue],
    cycles: [],
    labels: [],
    viewMode: "list",
    setViewMode: () => undefined,
    selected: [],
    setSelected: () => undefined,
    pendingIssueId: null,
    reorderBusy: false,
    onUpdate: () => undefined,
    onRestore: () => undefined,
    onFocusIssue: () => undefined,
    filterInputRef: { current: null },
    displayInputRef: { current: null },
    modifierLabel: "Ctrl",
    onReorder: () => undefined,
    onBulk: async () => undefined,
    bulkBusy: false,
    resetBulkMutation: () => undefined,
    onCreate: () => undefined,
    onOpenIssue: () => undefined,
    showScopeFilter: false,
  });
}

describe("Issue date inputs and current calendar", () => {
  it.each(["Asia/Tokyo", "America/Los_Angeles", "UTC"])(
    "[表示日] browser=%sでもreadonly ListのUTC期限日を動かさない",
    async (browserTimezone) => {
      vi.stubEnv("TZ", browserTimezone);
      const markup = renderToStaticMarkup(
        readonlyList(reviewIssue("read-only", { dueAt: Date.UTC(2026, 9, 2) })),
      );
      expect(
        new JSDOM(markup).window.document.querySelector(".issue-row .due-cell")?.textContent,
      ).toBe("10月2日");
    },
  );
  it("[Home/設定変更] todayだけをOwnerTZで切り替え、同じ期限日は書き換えない", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 1, 15));
    await render("/");
    const section = (label: string) =>
      [...dom.window.document.querySelectorAll(".home-issue-section")].find(
        (item) => item.querySelector(".eyebrow")?.textContent === label,
      )!;
    expect(
      section("TODAY").querySelector('button[data-issue-id="issue-1"] .home-issue-due')
        ?.textContent,
    ).toBe("今日");
    const stored = data.issues[0].dueAt;
    await timezone("America/Los_Angeles");
    expect(section("TODAY").querySelector(".count-pill")?.textContent).toBe("0");
    expect(
      section("NEXT 7 DAYS").querySelector('button[data-issue-id="issue-1"] .home-issue-due')
        ?.textContent,
    ).toBe("7日以内");
    expect(queryClient.getQueryData<BootstrapViewModel>(["bootstrap"])?.issues[0].dueAt).toBe(
      stored,
    );
    await timezone("Asia/Tokyo");
    expect(
      section("TODAY").querySelector('button[data-issue-id="issue-1"] .home-issue-due')
        ?.textContent,
    ).toBe("今日");
    expect(requests.filter(({ init }) => init.method === "PATCH")).toHaveLength(0);
  });
  it("[入力/設定変更] ListとDetailはOwnerTZ変更後も旧non-midnightのUTC日を保持しUTC midnightを保存する", async () => {
    data.issues[0] = { ...data.issues[0], dueAt: Date.UTC(2026, 9, 2, 23, 59) };
    await render();
    expect(dueInput().value).toBe("2026-10-02");
    await timezone("America/Los_Angeles");
    expect(dueInput().value).toBe("2026-10-02");
    expect(data.issues[0].dueAt).toBe(Date.UTC(2026, 9, 2, 23, 59));
    await act(async () => setValue(dueInput(), "2026-10-03"));
    expect(dueInput().value).toBe("2026-10-03");
    // Deep link は新しい URL で描画し直す。
    await app!.unmount();
    await render("/issues/issue-1");
    const detailDue = dom.window.document.querySelector("#issue-due-date") as HTMLInputElement;
    expect(detailDue.value).toBe("2026-10-03");
    await act(async () => setValue(detailDue, "2026-10-04"));
    const patches = requests.filter(({ init }) => init.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[0].init.body as string).patch).toEqual({
      dueAt: Date.UTC(2026, 9, 3),
    });
    expect(JSON.parse(patches[1].init.body as string).patch).toEqual({
      dueAt: Date.UTC(2026, 9, 4),
    });
    await timezone("UTC");
    expect(detailDue.value).toBe("2026-10-04");
  });
  it("[Composer保存] date入力は従来のUTC midnight数値で作成する", async () => {
    await render();
    const open = dom.window.document.querySelector(
      ".page-heading .button.primary",
    ) as HTMLButtonElement;
    await act(async () => open.click());
    const title = dom.window.document.querySelector(".composer textarea") as HTMLTextAreaElement;
    const due = dom.window.document.querySelector("#new-issue-due-date") as HTMLInputElement;
    await act(async () => {
      setValue(title, "Date composer");
      setValue(due, "2026-10-04");
    });
    const create = [...dom.window.document.querySelectorAll(".composer button")].find((button) =>
      button.textContent?.includes("作成"),
    )!;
    await act(async () => create.click());
    const post = requests.find(
      ({ path, init }) => path === "/api/v1/issues" && init.method === "POST",
    )!;
    expect(JSON.parse(post.init.body as string).dueAt).toBe(Date.UTC(2026, 9, 4));
  });
  it("[日付境界/常時表示] 23:59から00:00を越えるとtoday Filterを再計算する", async () => {
    await render("/issues?due=today&completed=true");
    expect(dom.window.document.querySelector('button[data-issue-id="issue-1"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(dom.window.document.querySelector('button[data-issue-id="issue-1"]')).toBeNull();
    expect(dom.window.document.querySelector('button[data-issue-id="issue-2"]')).not.toBeNull();
  });
  it.each(["focus", "online"])(
    "[日付境界/復帰] %s復帰時にタイマーを待たずtodayを再計算する",
    async (event) => {
      await render("/issues?due=today&completed=true");
      vi.setSystemTime(Date.UTC(2026, 9, 2, 15, 0, 20));
      await act(async () => dom.window.dispatchEvent(new dom.window.Event(event)));
      expect(dom.window.document.querySelector('button[data-issue-id="issue-1"]')).toBeNull();
      expect(dom.window.document.querySelector('button[data-issue-id="issue-2"]')).not.toBeNull();
    },
  );
});
