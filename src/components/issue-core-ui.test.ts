import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IssueViewModel as Issue, ProjectViewModel as Project } from "../shared/view-models";
import { CommandPalette, IssueComposer, IssuesView, SearchView } from "./OrbitApp";
import { nextCommandIndex, shortcutActionFor, shortcutModifierLabel } from "./issue-core-ui";

describe("Phase 2 Issue core UI helpers", () => {
  it("[デシジョンテーブル] modifier shortcutと単一キーの発火条件を分ける", () => {
    expect(shortcutActionFor({ key: "k", ctrlKey: true, editable: true })).toBe("command");
    expect(shortcutActionFor({ key: "f", metaKey: true, editable: false })).toBe("focus-search");
    expect(shortcutActionFor({ key: "b", ctrlKey: true, editable: false })).toBe("toggle-board");
    expect(shortcutActionFor({ key: "c", editable: false })).toBe("create");
    expect(shortcutActionFor({ key: "c", editable: true })).toBeNull();
    expect(shortcutActionFor({ key: "f", editable: true })).toBeNull();
    expect(shortcutActionFor({ key: "V", shiftKey: true, editable: false })).toBe("focus-display");
    expect(shortcutActionFor({ key: "x", editable: false })).toBe("toggle-selection");
    expect(shortcutActionFor({ key: "?", editable: false })).toBe("help");
  });

  it("[状態遷移] Command候補のArrow選択は循環し、空候補は安全に留まる", () => {
    expect(nextCommandIndex(3, 0, 1)).toBe(1);
    expect(nextCommandIndex(3, 2, 1)).toBe(0);
    expect(nextCommandIndex(3, 0, -1)).toBe(2);
    expect(nextCommandIndex(0, 0, 1)).toBe(-1);
  });

  it("[代表値] OSに応じてmodifier表示を切り替える", () => {
    expect(shortcutModifierLabel("MacIntel")).toBe("⌘");
    expect(shortcutModifierLabel("iPhone")).toBe("⌘");
    expect(shortcutModifierLabel("Win32")).toBe("Ctrl");
    expect(shortcutModifierLabel(undefined)).toBe("Ctrl");
  });

  it("[アクセシビリティ] Command paletteは選択中Issueの操作とactive候補を公開する", () => {
    const issue = {
      id: "issue-1",
      userId: "owner",
      number: 1,
      identifier: "TASK-1",
      title: "選択中Issue",
      description: "",
      statusId: "state-1",
      priority: "no_priority" as const,
      estimate: null,
      dueAt: null,
      projectId: null,
      cycleId: null,
      parentId: null,
      labelIds: [],
      position: 0,
      version: 1,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Issue;
    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        onClose: () => undefined,
        onCreate: () => undefined,
        onNavigate: () => undefined,
        onSearch: () => undefined,
        selectedIssue: issue,
        onOpenSelected: () => undefined,
        onArchiveSelected: () => undefined,
        onClearSelection: () => undefined,
        modifierLabel: "⌘",
      }),
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("選択中Issueを開く");
    expect(markup).toContain("選択中Issueをアーカイブ");
    expect(markup).toContain("選択解除");
  });

  it("[代表値] Issue composerとSearch viewはPhase 2の属性・Filter導線を公開する", () => {
    const composer = renderToStaticMarkup(
      createElement(IssueComposer, {
        title: "",
        setTitle: () => undefined,
        projects: [],
        projectId: "",
        setProjectId: () => undefined,
        priority: "no_priority",
        setPriority: () => undefined,
        dueAt: null,
        setDueAt: () => undefined,
        parentId: "",
        setParentId: () => undefined,
        issues: [],
        onClose: () => undefined,
        onSubmit: () => undefined,
        busy: false,
      }),
    );
    expect(composer).not.toContain("Estimate");
    expect(composer).toContain('aria-label="新しいIssueのDue date"');
    expect(composer).toContain('aria-label="新しいIssueのParent"');

    const search = renderToStaticMarkup(
      createElement(SearchView, {
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
        modifierLabel: "Ctrl",
      }),
    );
    expect(search).toContain('aria-label="検索Status"');
    expect(search).toContain('aria-label="検索Due"');
    expect(search).toContain("最近開いたIssue");
    expect(search).toContain("最近の検索");
  });

  it("[状態遷移] Archived scopeはRestore導線を表示し、属性編集を無効にする", () => {
    const issue = {
      id: "issue-archived",
      userId: "owner",
      number: 2,
      identifier: "TASK-2",
      title: "Archived Issue",
      description: "",
      statusId: "state-1",
      priority: "no_priority" as const,
      estimate: null,
      dueAt: null,
      projectId: null,
      cycleId: null,
      parentId: null,
      labelIds: [],
      position: 0,
      version: 1,
      archivedAt: 2,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 2,
    } satisfies Issue;
    const project = {
      id: "project-1",
      userId: "owner",
      name: "Roadmap",
      statusId: "project-status",
      priority: "no_priority" as const,
      color: "#ff725e",
      icon: "◈",
      description: "",
      startAt: null,
      targetAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Project;
    const markup = renderToStaticMarkup(
      createElement(IssuesView, {
        issues: [issue],
        scope: "archived",
        scopeLoading: false,
        setScope: () => undefined,
        workflowStates: [
          {
            id: "state-1",
            userId: "owner",
            name: "Todo",
            category: "unstarted" as const,
            color: "#888888",
            position: 0,
            isDefault: true,
          },
        ],
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
        projects: [project],
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
      }),
    );
    expect(markup).toContain('aria-label="Issueの表示範囲"');
    expect(markup).toContain('aria-label="Projectで絞り込む"');
    expect(markup).toContain("Projectなし");
    expect(markup).toContain('value="project-1">Roadmap</option>');
    expect(markup).toContain("復元");
    expect(markup).not.toContain('aria-label="TASK-2のEstimate"');
    expect(markup).toContain('class="view-toggle-group"');
  });
});
