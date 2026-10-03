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
import { normalizeViewSearch } from "./saved-views";
import { queryClient } from "../lib/query";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
let dom: JSDOM;
let root: Root;
const data = reviewBootstrap([reviewIssue("high"), reviewIssue("low", { priority: "low" })]);
data.views = [
  {
    id: "high-view",
    name: "High",
    userId: "owner",
    createdAt: 1,
    updatedAt: 1,
    query: {
      mode: "list",
      filter: { priorities: ["high"] },
      order: "manual",
      layout: {},
      limit: 100,
      showEmptyGroups: false,
    },
    layout: {},
  },
];
function makeRouter(entry: string) {
  const base = createRootRoute({ component: Outlet });
  const views = createRoute({
    getParentRoute: () => base,
    path: "/views",
    validateSearch: normalizeViewSearch,
    component: () =>
      createElement(OrbitApp, { initialSection: "views", viewSearch: views.useSearch() }),
  });
  return createRouter({
    routeTree: base.addChildren([views]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMinMs: 0,
  });
}
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/views" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    scrollTo: vi.fn(),
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(name, value);
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  queryClient.setQueryData(["bootstrap"], data);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(path === "/api/v1/background-runs/current" ? { run: null } : data),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.unstubAllGlobals();
});
async function render(router: ReturnType<typeof makeRouter>) {
  await act(async () => {
    await router.load();
    root.render(createElement(RouterProvider, { router }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
}
describe("Saved View URL", () => {
  it("[URL/再読込] selecting updates the URL and a fresh router restores the filtered workspace", async () => {
    const router = makeRouter("/views");
    await render(router);
    await act(async () => {
      (dom.window.document.querySelector(".saved-view-select") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(router.state.location.search).toEqual({ view: "high-view" });
    const href = router.state.location.href;
    await act(async () => root.unmount());
    root = createRoot(dom.window.document.getElementById("root")!);
    await render(makeRouter(href));
    expect(dom.window.document.querySelector('[aria-label="HighのIssue"]')?.textContent).toContain(
      "TASK-high",
    );
    expect(
      dom.window.document.querySelector('[aria-label="HighのIssue"]')?.textContent,
    ).not.toContain("TASK-low");
  });
});
