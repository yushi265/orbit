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
import { normalizeIssueSearch, normalizeProjectSearch } from "../lib/url-state/issues";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
let dom: JSDOM;
let root: Root;
let unexpected: string[];
const now = Date.UTC(2026, 9, 2, 3);
const payload = reviewBootstrap([
  reviewIssue("past", { dueAt: Date.UTC(2026, 9, 1) }),
  reviewIssue("today", { dueAt: Date.UTC(2026, 9, 2) }),
  reviewIssue("seven", { dueAt: Date.UTC(2026, 9, 9) }),
  reviewIssue("eight", { dueAt: Date.UTC(2026, 9, 10) }),
  reviewIssue("done", { statusId: "done" }),
  reviewIssue("canceled", { statusId: "canceled" }),
]);
payload.workflowStates.push(
  { ...payload.workflowStates[0], id: "done", name: "Done", category: "completed" },
  { ...payload.workflowStates[0], id: "canceled", name: "Canceled", category: "canceled" },
);
payload.projects.push(
  { ...payload.projects[0], id: "archived-project", name: "Archived", archivedAt: 1 },
  { ...payload.projects[0], id: "deleted-project", name: "Deleted", deletedAt: 1 },
);
payload.cycles.push({
  id: "cycle-1",
  userId: "owner",
  number: 1,
  name: "Current Cycle 1",
  nameOverride: null,
  description: "",
  startsAt: now - 1000,
  endsAt: now + 86400000,
  status: "active",
  completedAt: null,
  scheduleOverridden: false,
});
function makeRouter(entry = "/") {
  const base = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => base,
    path: "/",
    component: () => createElement(OrbitApp, { initialSection: "home" }),
  });
  const issues = createRoute({
    getParentRoute: () => base,
    path: "/issues",
    validateSearch: normalizeIssueSearch,
    component: () =>
      createElement(OrbitApp, { initialSection: "issues", issueSearch: issues.useSearch() }),
  });
  const projects = createRoute({
    getParentRoute: () => base,
    path: "/projects",
    validateSearch: normalizeProjectSearch,
    component: () =>
      createElement(OrbitApp, {
        initialSection: "projects",
        projectSearch: projects.useSearch(),
      } as Parameters<typeof OrbitApp>[0] & {
        projectSearch: ReturnType<typeof normalizeProjectSearch>;
      }),
  });
  const cycle = createRoute({
    getParentRoute: () => base,
    path: "/cycles/$cycleId",
    component: () => createElement("div", null, cycle.useParams().cycleId),
  });
  return createRouter({
    routeTree: base.addChildren([home, issues, projects, cycle]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMinMs: 0,
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
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
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  queryClient.setQueryData(["bootstrap"], payload);
  unexpected = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      if (path === "/api/v1/bootstrap" && (init.method ?? "GET") === "GET")
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      if (path === "/api/v1/background-runs/current" && (init.method ?? "GET") === "GET")
        return new Response(JSON.stringify({ run: null }), {
          headers: { "content-type": "application/json" },
        });
      unexpected.push(`${init.method ?? "GET"} ${path}`);
      throw new Error("Unexpected request");
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
async function render(entry = "/") {
  const router = makeRouter(entry);
  await act(async () => {
    await router.load();
    root.render(createElement(RouterProvider, { router }));
  });
  await settle();
  return router;
}
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
function metric(label: string) {
  return [...dom.window.document.querySelectorAll(".metric-card")].find((card) =>
    card.textContent?.includes(label),
  )!;
}
describe("Home exact list links", () => {
  it("[Open件数] Homeと一致するopen=true一覧はCompleted/Canceledを除外する", async () => {
    const router = await render();
    const link = metric("OPEN ISSUES").querySelector("a")!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain("4");
    await act(async () => link.click());
    await settle();
    expect(router.state.location.search).toMatchObject({ open: true });
    expect(dom.window.document.querySelectorAll(".issue-row")).toHaveLength(4);
    expect(dom.window.document.querySelector('[data-issue-id="done"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-issue-id="canceled"]')).toBeNull();
  });
  it("[既存条件] completed=falseはCanceledを維持しopen条件だけが追加で除外する", async () => {
    await render("/issues?completed=false");
    expect(dom.window.document.querySelectorAll(".issue-row")).toHaveLength(5);
    expect(dom.window.document.querySelector('[data-issue-id="done"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-issue-id="canceled"]')).not.toBeNull();
  });
  it.each([
    ["OVERDUE", "overdue", "past"],
    ["TODAY", "today", "today"],
    ["NEXT 7 DAYS", "next7", "seven"],
  ])("[期限区分] %sは同じ件数の%s一覧へ遷移する", async (label, due, id) => {
    const router = await render();
    const section = [...dom.window.document.querySelectorAll(".home-issue-section")].find(
      (section) => section.querySelector(".eyebrow")?.textContent === label,
    )!;
    const link = section.querySelector("a")!;
    expect(link).not.toBeNull();
    await act(async () => link.click());
    await settle();
    expect(router.state.location.search).toMatchObject({ open: true, due });
    expect(dom.window.document.querySelectorAll(".issue-row")).toHaveLength(1);
    expect(dom.window.document.querySelector(`button[data-issue-id="${id}"]`)).not.toBeNull();
  });
  it("[Active Projects] active=trueではHomeの件数と一致し通常一覧を変えない", async () => {
    const router = await render();
    const link = metric("PROJECTS").querySelector("a")!;
    expect(link).not.toBeNull();
    await act(async () => link.click());
    await settle();
    expect(router.state.location.pathname).toBe("/projects");
    expect(router.state.location.search).toEqual({ active: true });
    expect(dom.window.document.querySelectorAll(".project-card")).toHaveLength(1);
    await act(async () => router.navigate({ to: "/projects" }));
    await settle();
    expect(dom.window.document.querySelectorAll(".project-card")).toHaveLength(3);
  });
  it("[Current Cycle] 現在Cycleの見出しはその詳細へ遷移しnested interactiveを作らない", async () => {
    const router = await render();
    const link = dom.window.document.querySelector(".cycle-card h2 a")!;
    expect(link).not.toBeNull();
    expect(dom.window.document.querySelectorAll("a a, a button")).toHaveLength(0);
    await act(async () => (link as HTMLAnchorElement).click());
    await settle();
    expect(router.state.location.pathname).toBe("/cycles/cycle-1");
  });
});
