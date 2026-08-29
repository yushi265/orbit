import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateCycleBreakdown, type CycleBreakdown } from "./cycle-breakdown";
import { CycleBreakdownSection, CyclesView, OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { OrbitStore } from "../server/store";
import type {
  CycleViewModel as Cycle,
  IssueViewModel as Issue,
  ProjectViewModel as Project,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";

const states = [
  { id: "backlog", name: "Backlog", category: "backlog" },
  { id: "todo", name: "Todo", category: "unstarted" },
  { id: "started", name: "In progress", category: "started" },
  { id: "done", name: "Done", category: "completed" },
  { id: "canceled", name: "Canceled", category: "canceled" },
];

const projects = [
  { id: "project-a", name: "Project A" },
  { id: "project-empty", name: "空Project" },
];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn() }),
}));

function breakdownRows(dom: JSDOM, labelledBy: string) {
  return [
    ...dom.window.document.querySelectorAll(
      `[aria-labelledby="${labelledBy}"] .cycle-breakdown-row`,
    ),
  ].map((row) => ({
    label: row.querySelector("span")?.textContent,
    count: row.querySelector("strong")?.textContent,
  }));
}

function setupDom(url = "https://orbit.example/cycles") {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return dom;
}

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("Cycle breakdown", () => {
  it("[代表値] Status / Priority / Project別にIssue数を集計し、未知ProjectはProjectなしへ寄せる", () => {
    const breakdown = calculateCycleBreakdown(
      [
        { statusId: "todo", priority: "high", projectId: "project-a" },
        { statusId: "done", priority: "medium", projectId: null },
        { statusId: "canceled", priority: "no_priority", projectId: "missing-project" },
        { statusId: "started", priority: "low", projectId: "project-a" },
        { statusId: "backlog", priority: "urgent", projectId: "project-empty" },
      ],
      states,
      projects,
    );

    expect(breakdown.statuses).toEqual([
      { id: "backlog", label: "Backlog", count: 1 },
      { id: "todo", label: "Todo", count: 1 },
      { id: "started", label: "In progress", count: 1 },
      { id: "done", label: "Done", count: 1 },
      { id: "canceled", label: "Canceled", count: 1 },
    ]);
    expect(breakdown.priorities).toEqual([
      { value: "no_priority", count: 1 },
      { value: "low", count: 1 },
      { value: "medium", count: 1 },
      { value: "high", count: 1 },
      { value: "urgent", count: 1 },
    ]);
    expect(breakdown.projects).toEqual([
      { id: "project-a", label: "Project A", count: 2 },
      { id: "project-empty", label: "空Project", count: 1 },
      { id: null, label: "Projectなし", count: 2 },
    ]);
    expect(breakdown.statuses.reduce((total, entry) => total + entry.count, 0)).toBe(5);
    expect(breakdown.priorities.reduce((total, entry) => total + entry.count, 0)).toBe(5);
    expect(breakdown.projects.reduce((total, entry) => total + entry.count, 0)).toBe(5);
  });

  it("[境界値] Issueがない場合はStatus / Priorityを0件、Projectを空で返す", () => {
    const breakdown = calculateCycleBreakdown([], states, projects);
    expect(breakdown).toEqual({
      statuses: [
        { id: "backlog", label: "Backlog", count: 0 },
        { id: "todo", label: "Todo", count: 0 },
        { id: "started", label: "In progress", count: 0 },
        { id: "done", label: "Done", count: 0 },
        { id: "canceled", label: "Canceled", count: 0 },
      ],
      priorities: [
        { value: "no_priority", count: 0 },
        { value: "low", count: 0 },
        { value: "medium", count: 0 },
        { value: "high", count: 0 },
        { value: "urgent", count: 0 },
      ],
      projects: [],
    });
    const markup = renderToStaticMarkup(createElement(CycleBreakdownSection, { breakdown }));
    expect(markup).toContain("Status別内訳");
    expect(markup).toContain("Priority別内訳");
    expect(markup).toContain("Projectの内訳はありません。");
    expect(markup).toContain(">0</strong>");
  });

  it("[代表値] 内訳UIはStatus / Priority / Projectの件数と空Projectを表示する", () => {
    const breakdown: CycleBreakdown = {
      statuses: [
        { id: "backlog", label: "Backlog", count: 0 },
        { id: "todo", label: "Todo", count: 1 },
        { id: "started", label: "In progress", count: 0 },
        { id: "done", label: "Done", count: 0 },
        { id: "canceled", label: "Canceled", count: 0 },
      ],
      priorities: [
        { value: "no_priority", count: 0 },
        { value: "low", count: 0 },
        { value: "medium", count: 0 },
        { value: "high", count: 0 },
        { value: "urgent", count: 1 },
      ],
      projects: [{ id: null, label: "Projectなし", count: 1 }],
    };
    const markup = renderToStaticMarkup(createElement(CycleBreakdownSection, { breakdown }));

    expect(markup).toContain('aria-label="Cycleの内訳"');
    expect(markup).toContain('aria-labelledby="cycle-status-breakdown-title"');
    expect(markup).toContain('aria-labelledby="cycle-priority-breakdown-title"');
    expect(markup).toContain('aria-labelledby="cycle-project-breakdown-title"');
    expect(markup).toContain("Urgent");
    expect(markup).toContain("Projectなし");
    expect(markup).toContain(">1</strong>");
  });

  it("[代表値] Cycle詳細はBootstrapのIssue / Status / Projectから内訳を表示する", () => {
    const cycleView: Cycle = {
      id: "cycle-view",
      userId: "owner",
      number: 1,
      name: "Cycle 1",
      nameOverride: null,
      description: "",
      startsAt: 1,
      endsAt: 2,
      status: "active",
      completedAt: null,
      scheduleOverridden: false,
    };
    const viewStates: WorkflowState[] = states.map((state, position) => ({
      ...state,
      userId: "owner",
      color: "#888888",
      position,
      isDefault: position === 0,
      category: state.category as WorkflowState["category"],
    }));
    const viewIssue: Issue = {
      id: "cycle-issue",
      userId: "owner",
      number: 1,
      identifier: "TASK-1",
      title: "集計対象",
      description: "",
      statusId: "todo",
      priority: "urgent",
      estimate: null,
      dueAt: null,
      projectId: "project-a",
      cycleId: cycleView.id,
      parentId: null,
      labelIds: [],
      position: 0,
      version: 1,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const projectView: Project = {
      id: "project-a",
      userId: "owner",
      name: "Project A",
      statusId: "project-status",
      priority: "no_priority",
      color: "#888888",
      icon: "◈",
      description: "",
      startAt: null,
      targetAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const markup = renderToStaticMarkup(
      createElement(CyclesView, {
        cycles: [cycleView],
        cycleHistory: [],
        issues: [viewIssue],
        projects: [projectView],
        workflowStates: viewStates,
        pendingIssueId: null,
        onUpdateIssue: () => undefined,
        onRefresh: () => undefined,
        onNavigateIssues: () => undefined,
        onNavigateCycles: () => undefined,
        closeBusy: false,
        startBusy: false,
        onClose: () => undefined,
        onStart: async () => false,
      }),
    );

    expect(markup).toContain("Cycleの内訳");
    expect(markup).toContain("Status別内訳");
    expect(markup).toContain("Priority別内訳");
    expect(markup).toContain("Project A");
    expect(markup).toContain("Urgent");

    const dom = new JSDOM(markup);
    expect(breakdownRows(dom, "cycle-status-breakdown-title")).toEqual([
      { label: "Backlog", count: "0" },
      { label: "Todo", count: "1" },
      { label: "In progress", count: "0" },
      { label: "Done", count: "0" },
      { label: "Canceled", count: "0" },
    ]);
    expect(breakdownRows(dom, "cycle-priority-breakdown-title")).toEqual([
      { label: "No priority", count: "0" },
      { label: "Low", count: "0" },
      { label: "Medium", count: "0" },
      { label: "High", count: "0" },
      { label: "Urgent", count: "1" },
    ]);
    expect(breakdownRows(dom, "cycle-project-breakdown-title")).toEqual([
      { label: "Project A", count: "1" },
    ]);

    const metrics = dom.window.document.querySelector('[aria-label="Cycle進捗"]');
    expect(
      [...(metrics?.querySelectorAll("strong") ?? [])].map((entry) => entry.textContent),
    ).toEqual(["1", "0", "0%"]);

    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(styles).toContain(
      ".cycle-breakdown-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(styles).toContain(
      "@media (min-width: 768px) and (max-width: 1023px) { .cycle-breakdown-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }",
    );
    expect(styles).toContain(
      "@media (max-width: 767px) { .cycle-breakdown-grid { grid-template-columns: 1fr;",
    );
  });

  it("[統合] BootstrapのProjectをOrbitAppからCycle内訳へ渡す", async () => {
    const store = new OrbitStore(() => 1_700_000_000_000);
    store.ensureOwner("owner", "owner@example.com");
    const initial = store.bootstrap("owner");
    const activeCycle = initial.cycles.find((cycle) => cycle.status === "active");
    const todo = initial.workflowStates.find((state) => state.category === "unstarted");
    const projectStatus = initial.projectStatuses.find((status) => status.isDefault);
    if (!activeCycle || !todo || !projectStatus) throw new Error("test fixture is incomplete");
    const project = store.createProject("owner", {
      idempotencyKey: "cycle-breakdown-project",
      name: "Project A",
      statusId: projectStatus.id,
    });
    store.createIssue("owner", {
      idempotencyKey: "cycle-breakdown-issue",
      title: "Cycle issue",
      statusId: todo.id,
      priority: "urgent",
      projectId: project.id,
      cycleId: activeCycle.id,
    });
    const payload = store.bootstrap("owner");
    const fetchMock = vi.fn(async (input: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        typeof input === "string" && input.endsWith("/api/v1/bootstrap")
          ? payload
          : { issueViews: [], searches: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const dom = setupDom(`https://orbit.example/cycles/${activeCycle.id}`);
    const root = createRoot(dom.window.document.getElementById("root")!);

    try {
      await act(async () => {
        root.render(
          createElement(OrbitApp, {
            initialSection: "cycles",
            cycleId: activeCycle.id,
          }),
        );
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (dom.window.document.querySelector('[aria-label="Cycleの内訳"]')) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/bootstrap");
      expect(dom.window.document.querySelector('[aria-label="Cycleの内訳"]')).not.toBeNull();
      expect(
        dom.window.document.querySelector('[aria-labelledby="cycle-project-breakdown-title"]')
          ?.textContent,
      ).toContain("Project A");
    } finally {
      await act(async () => {
        root.unmount();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  });
});
