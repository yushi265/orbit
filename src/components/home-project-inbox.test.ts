import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapViewModel, IssueViewModel as Issue } from "../shared/view-models";
import { HomeView, ProjectsView } from "./OrbitApp";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", props, children),
  useRouter: () => ({ navigate: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

const now = Date.now();
const states = [
  {
    id: "todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted" as const,
    color: "#888888",
    position: 0,
    isDefault: true,
  },
  {
    id: "done",
    userId: "owner",
    name: "Done",
    category: "completed" as const,
    color: "#42a579",
    position: 1,
    isDefault: false,
  },
  {
    id: "canceled",
    userId: "owner",
    name: "Canceled",
    category: "canceled" as const,
    color: "#d55e73",
    position: 2,
    isDefault: false,
  },
];

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    userId: "owner",
    number: 1,
    identifier: `TASK-${id}`,
    title: id,
    description: "",
    statusId: "todo",
    priority: "medium",
    estimate: null,
    dueAt: null,
    projectId: "project-1",
    cycleId: "cycle-1",
    parentId: null,
    labelIds: [],
    position: 0,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const project = {
  id: "project-1",
  userId: "owner",
  name: "Orbit Project",
  statusId: "project-status",
  priority: "high" as const,
  color: "#ff725e",
  icon: "◈",
  description: "作業をまとめるProject",
  startAt: null,
  targetAt: null,
  archivedAt: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
  position: 0,
};

function bootstrap(issues: Issue[] = [issue("1")]): BootstrapViewModel {
  return {
    me: { id: "owner", name: "太郎", email: "taro@example.com", avatarUrl: null, createdAt: now },
    preferences: {
      userId: "owner",
      timezone: "Asia/Tokyo",
      locale: "ja",
      theme: "system",
      colorTheme: "coral",
      estimateEnabled: true,
      issueCounter: 1,
    },
    cycleSettings: {
      userId: "owner",
      enabled: true,
      durationWeeks: 2,
      cooldownWeeks: 0,
      startWeekday: 1,
      futureCount: 3,
      autoAddToCurrentCycle: false,
    },
    workflowStates: states,
    projectStatuses: [
      {
        id: "project-status",
        userId: "owner",
        name: "In progress",
        category: "in_progress",
        color: "#4f7cff",
        position: 0,
        isDefault: true,
      },
    ],
    issues,
    labels: [{ id: "label-1", userId: "owner", name: "重要", color: "#ff725e" }],
    projects: [project],
    projectDisplayPreferences: [],
    cycles: [
      {
        id: "cycle-1",
        userId: "owner",
        number: 1,
        name: "Cycle 1",
        nameOverride: null,
        description: "",
        startsAt: now - 1_000,
        endsAt: now + 10_000,
        status: "active",
        completedAt: null,
        scheduleOverridden: false,
      },
    ],
    cycleHistory: [],
    cycleProgress: [],
    views: [],
    notifications: [],
    background: { run: null },
  };
}

type ProjectViewProps = Parameters<typeof ProjectsView>[0];

function projectViewProps(overrides: Partial<ProjectViewProps> = {}): ProjectViewProps {
  return {
    projects: [project],
    issues: [issue("1")],
    projectId: project.id,
    workflowStates: states,
    projectStatuses: bootstrap().projectStatuses,
    onReorderProject: async () => true,
    projectReorderBusy: false,
    onCreateIssue: () => undefined,
    onCreate: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
}

function projectViewElement(overrides: Partial<ProjectViewProps> = {}) {
  return createElement(ProjectsView, projectViewProps(overrides));
}

describe("Home / Project / Inbox workspace UI", () => {
  it("[代表値] Homeは日付と今日の作業セクションを表示し、見出しは上部バーに任せる", () => {
    const markup = renderToStaticMarkup(
      createElement(HomeView, {
        data: bootstrap([
          issue("1", { dueAt: now - 86_400_000 }),
          issue("2", { dueAt: now + 3 * 86_400_000 }),
        ]),
        onNavigate: () => undefined,
        onCreate: () => undefined,
        onOpenIssue: () => undefined,
      }),
    );

    expect(markup).not.toContain("<h1");
    expect(markup).toContain("home-date");
    expect(markup).not.toContain("おかえりなさい");
    expect(markup).toContain("期限超過");
    expect(markup).toContain("7日以内");
    expect(markup).toContain("Cycleの未完了Issue");
    expect(markup).toContain("最近更新されたIssue");
  });

  it("[境界値] Homeの各空セクションは次の行動を案内する", () => {
    const emptyData = bootstrap([]);
    emptyData.projects = [];
    const markup = renderToStaticMarkup(
      createElement(HomeView, {
        data: emptyData,
        onNavigate: () => undefined,
        onCreate: () => undefined,
        onOpenIssue: () => undefined,
      }),
    );

    expect(markup).toContain("期限超過のIssueはありません。");
    expect(markup).toContain("今日が期限のIssueはありません。");
    expect(markup).toContain("7日以内に期限が来るIssueはありません。");
    expect(markup).toContain("Current Cycleに未完了Issueはありません。");
    expect(markup).toContain("Projectはまだありません");
  });

  it("[代表値] Project詳細はIssue一覧を持たず、Issuesで開くリンクで未完了件数を示す", () => {
    const markup = renderToStaticMarkup(projectViewElement());

    expect(markup).not.toContain("PROJECT ISSUES");
    expect(markup).not.toContain('id="issues-status-filter"');
    expect(markup).toContain("Issuesで開く（未完了1件）");
  });

  it("[アクセシビリティ/レスポンシブ] 新しいworkspaceの主要CSSと390px向け縮退を持つ", () => {
    const rules = parseStyleRules();
    const mobile = "(max-width: 767px)";
    expect(declarationsFor(rules, ".home-deadline-grid").get("display")).toBe("grid");
    expect(declarationsFor(rules, ".project-detail-page").get("max-width")).toBe("1180px");
    expect(declarationsFor(rules, ".project-tabs").get("overflow-x")).toBe("auto");
    expect(declarationsFor(rules, ".home-deadline-grid", mobile).get("grid-template-columns")).toBe(
      "1fr",
    );
    expect(declarationsFor(rules, ".project-open-issues", mobile).get("width")).toBe("100%");
    expect(declarationsFor(rules, ".project-tab-header").get("flex-wrap")).toBe("wrap");
    expect(declarationsFor(rules, ".project-tabs", mobile).get("margin")).toBe("-14px -17px 14px");
  });
});

describe("Project 冪等キーの保持", () => {
  function mount() {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/projects/project-1",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    return { dom, root: createRoot(dom.window.document.getElementById("root")!) };
  }
  const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const clickText = async (dom: JSDOM, text: string) => {
    const button = [...dom.window.document.querySelectorAll("button")].find(
      (item) => item.textContent === text && !item.disabled,
    )!;
    await act(async () => {
      button.click();
      await settle();
    });
  };

  it("[状態遷移] Project編集保存が423で失敗した後の再試行は同じ冪等キーで送り、成功後の保存は新しいキーにする", async () => {
    const { dom, root } = mount();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "OPERATION_IN_PROGRESS", message: "ロック中です。" } }),
          { status: 423, headers: { "content-type": "application/json" } },
        ),
      )
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      root.render(projectViewElement());
      await settle();
    });
    await clickText(dom, "Projectを編集");
    await clickText(dom, "Projectを保存");
    await clickText(dom, "再試行");

    expect(fetch).toHaveBeenCalledTimes(2);
    const keys = fetch.mock.calls.map(
      ([, init]) => JSON.parse(String((init as RequestInit).body)).idempotencyKey,
    );
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);

    await clickText(dom, "Projectを編集");
    await clickText(dom, "Projectを保存");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(String((fetch.mock.calls[2][1] as RequestInit).body)).idempotencyKey,
    ).not.toBe(keys[0]);
    await act(async () => {
      root.unmount();
      await settle();
    });
  });
});
