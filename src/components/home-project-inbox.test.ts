import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api-client";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";
import type { BootstrapViewModel, IssueViewModel as Issue } from "../shared/view-models";
import { HomeView, InboxView, ProjectsView } from "./OrbitApp";

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
    timezone: "Asia/Tokyo",
    cycles: bootstrap().cycles,
    labels: bootstrap().labels,
    projectDisplayPreferences: [],
    selected: [],
    setSelected: () => undefined,
    pendingIssueId: null,
    reorderBusy: false,
    onReorderProject: async () => true,
    projectReorderBusy: false,
    onUpdateIssue: () => undefined,
    onReorderIssue: () => undefined,
    onBulk: async () => undefined,
    bulkBusy: false,
    resetBulkMutation: () => undefined,
    onCreateIssue: () => undefined,
    onSaveDisplayPreferences: async (projectId, nextSettings) => ({
      id: "preference-1",
      userId: "owner",
      projectId,
      settings: nextSettings,
      updatedAt: now,
    }),
    modifierLabel: "Ctrl",
    onCreate: () => undefined,
    onRefresh: () => undefined,
    onOpenIssue: () => undefined,
    ...overrides,
  };
}

function projectViewElement(overrides: Partial<ProjectViewProps> = {}) {
  return createElement(ProjectsView, projectViewProps(overrides));
}

describe("Home / Project / Inbox workspace UI", () => {
  it("[代表値] Homeは日付・控えめな見出しと今日の作業セクションを表示する", () => {
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

    expect(markup).toContain("<h1>Home</h1>");
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

  it("[代表値] Project詳細は専用workspaceとしてIssue一覧操作を表示する", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectsView, {
        projects: [project],
        issues: [issue("1")],
        projectId: project.id,
        workflowStates: states,
        projectStatuses: bootstrap().projectStatuses,
        timezone: "Asia/Tokyo",
        cycles: bootstrap().cycles,
        labels: bootstrap().labels,
        projectDisplayPreferences: [],
        selected: [],
        setSelected: () => undefined,
        pendingIssueId: null,
        reorderBusy: false,
        onReorderProject: async () => true,
        projectReorderBusy: false,
        onUpdateIssue: () => undefined,
        onReorderIssue: () => undefined,
        onBulk: async () => undefined,
        bulkBusy: false,
        resetBulkMutation: () => undefined,
        onCreateIssue: () => undefined,
        onSaveDisplayPreferences: async () => ({
          id: "preference-1",
          userId: "owner",
          projectId: project.id,
          settings: defaultProjectIssueDisplaySettings(),
          updatedAt: now,
        }),
        modifierLabel: "Ctrl",
        onCreate: () => undefined,
        onRefresh: () => undefined,
        onOpenIssue: () => undefined,
      }),
    );

    expect(markup).toContain("PROJECT ISSUES");
    expect(markup).toContain('id="issues-status-filter"');
    expect(markup).toContain('id="issues-due-filter"');
    expect(markup).toContain("完了Issueを表示");
    expect(markup).not.toContain("project-detail-workspace");
  });

  it("[代表値] Inboxは役割・手順・未読範囲を説明し、通知の開き方を示す", () => {
    const notification = {
      id: "notification-1",
      userId: "owner",
      type: "due_soon",
      title: "期限が近いIssue",
      body: "対象を確認してください。",
      entityType: "issue",
      entityId: "issue-1",
      readAt: null,
      deletedAt: null,
      createdAt: now,
    } as const;
    const markup = renderToStaticMarkup(
      createElement(InboxView, {
        notifications: [notification],
        onOpenNotification: async () => undefined,
        onMarkAllRead: async () => undefined,
        onNavigateIssues: () => undefined,
      }),
    );

    expect(markup).toContain("Inboxは通知を処理する場所です");
    expect(markup).toContain("通知の内容を確認");
    expect(markup).toContain("未読");
    expect(markup).toContain("期限が近い");
    expect(markup).toContain("開いて対象を確認");
    expect(markup).not.toContain("•••");
  });

  it("[境界値] 通知がないInboxも用途説明とIssue導線を表示する", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxView, {
        notifications: [],
        onOpenNotification: async () => undefined,
        onMarkAllRead: async () => undefined,
        onNavigateIssues: () => undefined,
      }),
    );

    expect(markup).toContain("Inboxは通知を処理する場所です");
    expect(markup).toContain("新しい通知はありません");
    expect(markup).toContain("Issueを見る");
  });

  it("[回帰] Inboxは未実装の通知生成を約束しない", () => {
    const markup = renderToStaticMarkup(
      createElement(InboxView, {
        notifications: [],
        onOpenNotification: async () => undefined,
        onMarkAllRead: async () => undefined,
        onNavigateIssues: () => undefined,
      }),
    );
    expect(markup).toContain("期限・Cycleの自動通知はまだ配信していません");
    expect(markup).not.toContain("Orbitからのお知らせがここに届きます");
  });

  it("[状態遷移] 未読に戻す失敗後も通知を保持し、再試行できる", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/inbox",
    });
    for (const key of ["window", "document", "navigator", "HTMLElement", "Node"] as const)
      vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const notification = {
      id: "n1",
      userId: "owner",
      type: "due_soon" as const,
      title: "期限",
      body: "対象を確認",
      entityType: "issue" as const,
      entityId: "i1",
      readAt: now,
      deletedAt: null,
      createdAt: now,
    };
    const onMarkUnread = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const onOpenNotification = vi.fn();
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root.render(
        createElement(InboxView, {
          notifications: [notification],
          onMarkUnread,
          onOpenNotification,
          onMarkAllRead: async () => undefined,
          onNavigateIssues: () => undefined,
        }),
      ),
    );
    await act(async () =>
      (dom.window.document.querySelector(".notification-unread") as HTMLButtonElement).click(),
    );
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "未読に戻せません",
    );
    expect(dom.window.document.querySelectorAll(".notification-row")).toHaveLength(1);
    await act(async () =>
      (dom.window.document.querySelector('[role="alert"] button') as HTMLButtonElement).click(),
    );
    expect(onMarkUnread).toHaveBeenCalledTimes(2);
    expect(onMarkUnread).toHaveBeenLastCalledWith(notification);
    expect(onOpenNotification).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("[状態遷移] Inboxの未読切替・個別既読・すべて既読を呼び出せる", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/inbox",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onOpenNotification = vi.fn().mockResolvedValue(undefined);
    const onMarkAllRead = vi.fn().mockResolvedValue(undefined);
    const notification = {
      id: "notification-1",
      userId: "owner",
      type: "due_soon" as const,
      title: "期限が近いIssue",
      body: "対象を確認してください。",
      entityType: "issue" as const,
      entityId: "issue-1",
      readAt: null,
      deletedAt: null,
      createdAt: now,
    };
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(InboxView, {
          notifications: [notification],
          onOpenNotification,
          onMarkAllRead,
          onNavigateIssues: () => undefined,
        }),
      );
    });
    const unreadTab = dom.window.document.querySelector(
      'button.inbox-filter[aria-pressed="false"]',
    ) as HTMLButtonElement;
    await act(async () => {
      unreadTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dom.window.document.querySelectorAll(".notification-row")).toHaveLength(1);
    await act(async () => {
      (dom.window.document.querySelector(".notification-main") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenNotification).toHaveBeenCalledWith(notification);
    await act(async () => {
      (dom.window.document.querySelector(".inbox-filter") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      (dom.window.document.querySelector(".button.ghost") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Projectの完了表示切替をdebounce保存し、保存中は操作を無効化する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/projects/project-1",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let resolveSave!: () => void;
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onSaveDisplayPreferences = vi
      .fn()
      .mockImplementation(
        async (
          projectId: string,
          settings: ReturnType<typeof defaultProjectIssueDisplaySettings>,
        ) => {
          await save;
          return { id: "preference-1", userId: "owner", projectId, settings, updatedAt: now };
        },
      );
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(ProjectsView, {
          projects: [project],
          issues: [issue("1")],
          projectId: project.id,
          workflowStates: states,
          projectStatuses: bootstrap().projectStatuses,
          timezone: "Asia/Tokyo",
          cycles: bootstrap().cycles,
          labels: bootstrap().labels,
          projectDisplayPreferences: [],
          selected: [],
          setSelected: () => undefined,
          pendingIssueId: null,
          reorderBusy: false,
          onReorderProject: async () => true,
          projectReorderBusy: false,
          onUpdateIssue: () => undefined,
          onReorderIssue: () => undefined,
          onBulk: async () => undefined,
          bulkBusy: false,
          resetBulkMutation: () => undefined,
          onCreateIssue: () => undefined,
          onSaveDisplayPreferences,
          modifierLabel: "Ctrl",
          onCreate: () => undefined,
          onRefresh: () => undefined,
          onOpenIssue: () => undefined,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const completedToggle = dom.window.document.querySelector(
      '.completed-toggle input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(completedToggle).not.toBeNull();
    await act(async () => {
      completedToggle.click();
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(onSaveDisplayPreferences).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ showCompleted: false }),
      expect.any(String),
    );
    expect(
      (
        dom.window.document.querySelector(
          'select[aria-label="Statusで絞り込む"]',
        ) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      resolveSave();
      await save;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] Project表示設定の409は最新再取得とRetryを表示する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/projects/project-1",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onSaveDisplayPreferences = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "別の表示設定が保存されています。"),
      );
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(ProjectsView, {
          projects: [project],
          issues: [issue("1")],
          projectId: project.id,
          workflowStates: states,
          projectStatuses: bootstrap().projectStatuses,
          timezone: "Asia/Tokyo",
          cycles: bootstrap().cycles,
          labels: bootstrap().labels,
          projectDisplayPreferences: [],
          selected: [],
          setSelected: () => undefined,
          pendingIssueId: null,
          reorderBusy: false,
          onReorderProject: async () => true,
          projectReorderBusy: false,
          onUpdateIssue: () => undefined,
          onReorderIssue: () => undefined,
          onBulk: async () => undefined,
          bulkBusy: false,
          resetBulkMutation: () => undefined,
          onCreateIssue: () => undefined,
          onSaveDisplayPreferences,
          modifierLabel: "Ctrl",
          onCreate: () => undefined,
          onRefresh,
          onOpenIssue: () => undefined,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const completedToggle = dom.window.document.querySelector(
      '.completed-toggle input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      completedToggle.click();
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(completedToggle.checked).toBe(false);
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "最新の表示設定を読み込みました",
    );
    const retry = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "再試行",
    ) as HTMLButtonElement;
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSaveDisplayPreferences).toHaveBeenCalledTimes(2);
    expect(onSaveDisplayPreferences.mock.calls[1][1]).toEqual(
      expect.objectContaining({ showCompleted: false }),
    );
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[代表値] Project workspaceのStatus・Bulk・Project scope reorderを既存操作へ接続する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/projects/project-1",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const first = issue("1");
    const second = issue("2", { position: 1 });
    const onUpdateIssue = vi.fn();
    const onBulk = vi.fn().mockResolvedValue(undefined);
    const onReorderIssue = vi.fn();
    const settings = { ...defaultProjectIssueDisplaySettings(), order: "manual" as const };
    const otherProject = { ...project, id: "project-2", name: "Other Project" };
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(ProjectsView, {
          projects: [project, otherProject],
          issues: [first, second, issue("foreign", { projectId: "project-2" })],
          projectId: project.id,
          workflowStates: states,
          projectStatuses: bootstrap().projectStatuses,
          timezone: "Asia/Tokyo",
          cycles: bootstrap().cycles,
          labels: bootstrap().labels,
          projectDisplayPreferences: [
            {
              id: "preference-1",
              userId: "owner",
              projectId: project.id,
              settings,
              updatedAt: now,
            },
          ],
          selected: [first.id],
          setSelected: () => undefined,
          pendingIssueId: null,
          reorderBusy: false,
          onReorderProject: async () => true,
          projectReorderBusy: false,
          onUpdateIssue,
          onReorderIssue,
          onBulk,
          bulkBusy: false,
          resetBulkMutation: () => undefined,
          onCreateIssue: () => undefined,
          onSaveDisplayPreferences: async () => ({
            id: "preference-1",
            userId: "owner",
            projectId: project.id,
            settings,
            updatedAt: now,
          }),
          modifierLabel: "Ctrl",
          onCreate: () => undefined,
          onRefresh: () => undefined,
          onOpenIssue: () => undefined,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const status = dom.window.document.querySelector(
      'select[aria-label="TASK-1のStatus"]',
    ) as HTMLSelectElement;
    await act(async () => {
      status.value = "done";
      status.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    expect(onUpdateIssue).toHaveBeenCalledWith(first, { statusId: "done" });
    await act(async () => {
      const priority = dom.window.document.querySelector(
        'select[aria-label="TASK-1のPriority"]',
      ) as HTMLSelectElement;
      priority.value = "urgent";
      priority.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      const projectSelect = dom.window.document.querySelector(
        'select[aria-label="TASK-1のProject"]',
      ) as HTMLSelectElement;
      projectSelect.value = otherProject.id;
      projectSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    expect(onUpdateIssue).toHaveBeenCalledWith(first, { priority: "urgent" });
    expect(onUpdateIssue).toHaveBeenCalledWith(first, { projectId: otherProject.id });
    expect(
      dom.window.document.querySelector('input[aria-label="TASK-1のDue date"]'),
    ).not.toBeNull();
    expect(dom.window.document.body.textContent).not.toContain("foreign");

    const bulkValue = dom.window.document.querySelector(
      'select[aria-label="一括更新値"]',
    ) as HTMLSelectElement;
    await act(async () => {
      bulkValue.value = "done";
      bulkValue.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      (dom.window.document.querySelector(".bulk-bar .button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onBulk).toHaveBeenCalledWith({ statusId: "done" });

    await act(async () => {
      (
        dom.window.document.querySelector(
          'button.drag-handle[aria-label="TASK-1の並び替え"]',
        ) as HTMLButtonElement
      ).dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onReorderIssue).toHaveBeenCalledWith(first, null, project.id);
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it.each([
    [400, "入力内容を確認してください。"],
    [423, "処理中のため保存できません。"],
    [500, "表示設定サービスに接続できません。"],
  ])("[異常系] Project表示設定の%j失敗はdraftを保持し自動再試行しない", async (status, message) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/projects/project-1",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onSaveDisplayPreferences = vi
      .fn()
      .mockRejectedValue(
        new ApiError(status, status === 423 ? "OPERATION_IN_PROGRESS" : "INTERNAL_ERROR", message),
      );
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(projectViewElement({ onSaveDisplayPreferences }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const completedToggle = dom.window.document.querySelector(
      '.completed-toggle input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      completedToggle.click();
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(completedToggle.checked).toBe(false);
    expect(onSaveDisplayPreferences).toHaveBeenCalledTimes(1);
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(message);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(onSaveDisplayPreferences).toHaveBeenCalledTimes(1);
    const retry = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "再試行",
    ) as HTMLButtonElement;
    expect(retry).not.toBeUndefined();
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSaveDisplayPreferences).toHaveBeenCalledTimes(2);
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[アクセシビリティ/レスポンシブ] 新しいworkspaceの主要CSSと390px向け縮退を持つ", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(styles).toContain(".home-deadline-grid");
    expect(styles).toContain(".project-detail-page");
    expect(styles).toContain(".inbox-guide");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain(".project-issues-workspace");
  });
});
