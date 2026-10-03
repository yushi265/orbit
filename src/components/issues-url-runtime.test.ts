import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { normalizeIssueSearch, type IssueSearch } from "../lib/url-state/issues";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let root: Root;
let unexpected: string[];
let bootstrapResponse: (() => void) | undefined;
let deferBootstrap = false;
let detailOverride: ReturnType<typeof reviewDetail> | undefined;
let conflictSave = false;
const first = reviewIssue("issue-1", { title: "needle" });
const second = reviewIssue("issue-2", { title: "other", priority: "low", labelIds: [] });
const payload = reviewBootstrap([first, second]);
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
function makeRouter(entry: string) {
  const base = createRootRoute({ component: Outlet });
  const list = createRoute({
    getParentRoute: () => base,
    path: "/issues",
    validateSearch: normalizeIssueSearch,
    component: () =>
      createElement(OrbitApp, {
        initialSection: "issues",
        issueSearch: list.useSearch(),
      } as Parameters<typeof OrbitApp>[0] & { issueSearch: IssueSearch }),
  });
  const detail = createRoute({
    getParentRoute: () => base,
    path: "/issues/$issueId",
    validateSearch: normalizeIssueSearch,
    component: () =>
      createElement(OrbitApp, {
        initialSection: "issues",
        issueId: detail.useParams().issueId,
        issueSearch: detail.useSearch(),
      } as Parameters<typeof OrbitApp>[0] & { issueSearch: IssueSearch }),
  });
  const home = createRoute({
    getParentRoute: () => base,
    path: "/",
    component: () => createElement(OrbitApp, { initialSection: "home" }),
  });
  return createRouter({
    routeTree: base.addChildren([list, detail, home]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMinMs: 0,
  });
}
beforeEach(() => {
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
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  deferBootstrap = false;
  bootstrapResponse = undefined;
  unexpected = [];
  detailOverride = undefined;
  conflictSave = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") {
        if (deferBootstrap)
          return new Promise<Response>((resolve) => {
            bootstrapResponse = () => resolve(json(payload));
          });
        return Promise.resolve(json(payload));
      }
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(json({ run: null }));
      if (path === "/api/v1/recent-issue-views" && method === "POST")
        return Promise.resolve(json({}));
      if (path === "/api/v1/issues/issue-1" && method === "GET")
        return Promise.resolve(json(detailOverride ?? { ...reviewDetail(first), parent: second }));
      if (path === "/api/v1/issues/issue-1" && method === "PATCH" && conflictSave)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "ISSUE_VERSION_CONFLICT", message: "競合しました。" },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
        );
      if (path === "/api/v1/issues/issue-2" && method === "GET")
        return Promise.resolve(json(reviewDetail(second)));
      if (path === "/api/v1/issues?scope=archived" && method === "GET")
        return Promise.resolve(json({ items: [first] }));
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error(`Unexpected API request: ${method} ${path}`));
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
async function render(entry: string) {
  const router = makeRouter(entry);
  await act(async () => {
    await router.load();
    root.render(createElement(RouterProvider, { router }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return router;
}
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function value(selector: string) {
  return (dom.window.document.querySelector(selector) as HTMLInputElement | HTMLSelectElement)
    ?.value;
}

describe("review Issues URL navigation", () => {
  it("[実Router/再読込] URLのFilter・Mode・Order・completedを描画し詳細往復でも維持する", async () => {
    dom.window.localStorage.setItem("orbit.issues.showCompleted", "true");
    const router = await render(
      "/issues?q=needle&status=todo&priority=high&project=project-1&label=label-1&order=manual&mode=board&completed=false",
    );
    await settled();
    expect(value("#issues-filter-input")).toBe("needle");
    expect(value("#issues-priority-filter")).toBe("high");
    expect(value("#issues-project-filter")).toBe("project-1");
    expect(value("#issues-status-filter")).toBe("todo");
    expect(value('select[aria-label="Labelで絞り込む"]')).toBe("label-1");
    expect(value("#issues-sort-select")).toBe("manual");
    expect(
      (dom.window.document.querySelector(".completed-toggle input") as HTMLInputElement).checked,
    ).toBe(false);
    expect(dom.window.document.querySelector(".view-toggle.selected")?.textContent).toContain(
      "Board",
    );
    const search = router.state.location.search;
    const trigger = dom.window.document.querySelector(
      'button[data-issue-id="issue-1"]',
    ) as HTMLButtonElement;
    await act(async () => {
      trigger.focus();
      trigger.click();
    });
    await settled();
    expect(router.state.location.pathname).toBe("/issues/issue-1");
    expect(router.state.location.search).toEqual(search);
    expect(dom.window.document.activeElement?.id).toBe("issue-detail-title");
    await act(async () =>
      (
        dom.window.document.querySelector('[aria-label="Issue詳細を閉じる"]') as HTMLButtonElement
      ).click(),
    );
    await settled();
    expect(router.state.location.pathname).toBe("/issues");
    expect(router.state.location.search).toEqual(search);
    expect(value("#issues-filter-input")).toBe("needle");
    expect(dom.window.document.activeElement).toBe(
      dom.window.document.querySelector('button[data-issue-id="issue-1"]'),
    );
  });
  it("[Home条件/詳細往復] open=trueを詳細と一覧への復帰で保持する", async () => {
    const router = await render("/issues?open=true&completed=true");
    await settled();
    await act(async () =>
      (
        dom.window.document.querySelector('button[data-issue-id="issue-1"]') as HTMLButtonElement
      ).click(),
    );
    await settled();
    expect(router.state.location.search).toEqual({ open: true, completed: true });
    await act(async () =>
      (
        dom.window.document.querySelector('[aria-label="Issue詳細を閉じる"]') as HTMLButtonElement
      ).click(),
    );
    await settled();
    expect(router.state.location.pathname).toBe("/issues");
    expect(router.state.location.search).toEqual({ open: true, completed: true });
  });
  it("[他画面の詳細導線] HomeからはIssuesの既定条件で開く", async () => {
    const router = await render("/?priority=low&q=unrelated&mode=board");
    await settled();
    const trigger = [...dom.window.document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("needle"),
    )!;
    expect(trigger).toBeDefined();
    await act(async () => trigger.click());
    await settled();
    expect(router.state.location.pathname).toBe("/issues/issue-1");
    expect(router.state.location.search).toEqual({ completed: true });
  });
  it("[実Router/URL更新] Storage fallbackを明示し、Filter更新とBoard切替をreplaceする", async () => {
    dom.window.localStorage.setItem("orbit.issues.showCompleted", "false");
    const router = await render("/issues");
    await settled();
    expect(
      (dom.window.document.querySelector(".completed-toggle input") as HTMLInputElement).checked,
    ).toBe(false);
    const navigate = vi.spyOn(router, "navigate");
    const priority = dom.window.document.querySelector(
      "#issues-priority-filter",
    ) as HTMLSelectElement;
    await act(async () => {
      priority.value = "low";
      priority.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await settled();
    expect(router.state.location.search).toEqual({ priority: "low", completed: false });
    expect(value("#issues-priority-filter")).toBe("low");
    expect(dom.window.document.querySelector('button[data-issue-id="issue-1"]')).toBeNull();
    expect(dom.window.document.querySelector('button[data-issue-id="issue-2"]')).not.toBeNull();
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ replace: true, resetScroll: false }),
    );
    expect(router.history.length).toBe(1);
    await act(async () =>
      dom.window.document.body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await settled();
    expect(router.state.location.search).toEqual({
      priority: "low",
      completed: false,
      mode: "board",
    });
    await act(async () =>
      dom.window.document.body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await settled();
    expect(router.state.location.search).toEqual({ priority: "low", completed: false });
    expect(router.history.length).toBe(1);
  });
  it("[data到着競合] Bootstrap取得前は参照IDを消さず、取得後に無効IDだけ補正する", async () => {
    deferBootstrap = true;
    const router = await render(
      "/issues?project=project-1&status=missing&label=label-1&completed=false",
    );
    expect(router.state.location.search).toEqual({
      project: "project-1",
      status: "missing",
      label: "label-1",
      completed: false,
    });
    await act(async () => bootstrapResponse?.());
    await settled();
    expect(router.state.location.search).toEqual({
      project: "project-1",
      label: "label-1",
      completed: false,
    });
    expect(value("#issues-project-filter")).toBe("project-1");
    expect(value("#issues-status-filter")).toBe("all");
  });
  it("[一括解除] Filter解除を1回replaceし、Mode/Orderを保持する", async () => {
    const router = await render(
      "/issues?q=no-match&priority=high&order=manual&mode=board&completed=false",
    );
    await settled();
    const navigate = vi.spyOn(router, "navigate");
    const clear = [...dom.window.document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("フィルターを解除"),
    )!;
    await act(async () => clear.click());
    await settled();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true, resetScroll: false }),
    );
    expect(router.state.location.search).toEqual({
      order: "manual",
      mode: "board",
      completed: true,
    });
  });
  it("[Archived409/一覧復帰] 競合の最新Issueと他rowをCacheから一覧へ表示する", async () => {
    const archived = { ...first, title: "古いArchived", archivedAt: 100 };
    const other = reviewIssue("issue-3", { title: "別のArchived", archivedAt: 100 });
    const latest = { ...archived, title: "最新Archived", version: 2 };
    queryClient.setQueryData(["bootstrap"], reviewBootstrap([second]));
    queryClient.setQueryData(["issues", "archived"], {
      items: [archived, other],
      cacheMarker: "keep",
    });
    queryClient.setQueryData(["issue-detail", first.id], reviewDetail(archived));
    const router = await render("/issues?scope=archived&completed=true");
    await settled();
    const trigger = dom.window.document.querySelector(
      'button[data-issue-id="issue-1"]',
    ) as HTMLButtonElement;
    expect(trigger.textContent).toContain("古いArchived");
    await act(async () => trigger.click());
    await settled();
    detailOverride = reviewDetail(latest);
    conflictSave = true;
    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    await act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(
        title,
        "自分のdraft",
      );
      title.dispatchEvent(
        Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
          propertyName: "value",
        }),
      );
      title.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(
      async () => {
        await settled();
        expect(title.value).toBe(latest.title);
      },
      { interval: 1, timeout: 1000 },
    );
    expect(queryClient.getQueryData(["issues", "archived"])).toEqual({
      items: [latest, other],
      cacheMarker: "keep",
    });
    expect(
      queryClient.getQueryData<ReturnType<typeof reviewBootstrap>>(["bootstrap"])?.issues,
    ).toEqual([second]);
    await act(async () => router.history.back());
    await settled();
    expect(router.state.location.pathname).toBe("/issues");
    expect(
      dom.window.document.querySelector('button[data-issue-id="issue-1"]')?.textContent,
    ).toContain("最新Archived");
    expect(
      dom.window.document.querySelector('button[data-issue-id="issue-3"]')?.textContent,
    ).toContain("別のArchived");
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([path]) => path === "/api/v1/issues?scope=archived"),
    ).toHaveLength(0);
  });
  it("[Detail内切替] 親Issueへ移動しても同じsearchを保持する", async () => {
    const router = await render(
      "/issues/issue-1?priority=high&order=title_asc&mode=board&completed=false",
    );
    await settled();
    const search = router.state.location.search;
    await vi.waitFor(
      async () => {
        await settled();
        expect(dom.window.document.querySelector(".hierarchy-parent")).not.toBeNull();
      },
      { timeout: 1000, interval: 1 },
    );
    const parent = dom.window.document.querySelector(".hierarchy-parent") as HTMLButtonElement;
    await act(async () => parent.click());
    await settled();
    expect(router.state.location.pathname).toBe("/issues/issue-2");
    expect(router.state.location.search).toEqual(search);
  });
});
