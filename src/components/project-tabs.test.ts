import { describe, expect, it } from "vitest";
import type {
  ProjectViewModel,
  ProjectStatusViewModel,
  WorkflowStateViewModel,
} from "../shared/view-models";
import { countOpenIssues, issuesEntryProjectId, selectProjectTabs } from "./project-tabs";
import { reviewIssue } from "./review-ui.test-fixtures";

// Issues画面のProjectタブ: 完了・中止以外のProjectを並び順で出し、未完了Issue数を添える。

function projectStatus(id: string, category: ProjectStatusViewModel["category"]) {
  return {
    id,
    userId: "owner",
    name: id,
    category,
    color: "#888888",
    position: 0,
    isDefault: false,
  } satisfies ProjectStatusViewModel;
}
function workflowState(id: string, category: WorkflowStateViewModel["category"]) {
  return {
    id,
    userId: "owner",
    name: id,
    category,
    color: "#888888",
    position: 0,
    isDefault: false,
  } satisfies WorkflowStateViewModel;
}
function project(id: string, overrides: Partial<ProjectViewModel> = {}): ProjectViewModel {
  return {
    id,
    userId: "owner",
    name: id,
    statusId: "progress",
    priority: "high",
    color: "#888888",
    icon: "◈",
    description: "",
    startAt: null,
    targetAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    position: 0,
    ...overrides,
  };
}
const projectStatuses = [
  projectStatus("backlog", "backlog"),
  projectStatus("planned", "planned"),
  projectStatus("progress", "in_progress"),
  projectStatus("completed", "completed"),
  projectStatus("canceled", "canceled"),
];
const workflowStates = [
  workflowState("todo", "unstarted"),
  workflowState("doing", "started"),
  workflowState("done", "completed"),
  workflowState("dropped", "canceled"),
];
const tabs = (projects: ProjectViewModel[], selected: string | null = null, issues = []) =>
  selectProjectTabs({
    projects,
    projectStatuses,
    issues,
    workflowStates,
    selectedProjectId: selected,
  });

describe("selectProjectTabs", () => {
  it.each([
    ["backlog", true],
    ["planned", true],
    ["progress", true],
    ["completed", false],
    ["canceled", false],
    ["missing-status", true],
  ] as const)("[同値分割] Project Status %s → タブに出る=%s", (statusId, shown) => {
    expect(tabs([project("p", { statusId })]).map((tab) => tab.id)).toEqual(shown ? ["p"] : []);
  });

  it.each([
    ["アーカイブ済み", { archivedAt: 5 }],
    ["削除済み", { deletedAt: 5 }],
  ] as const)("[同値分割] %sのProjectは出さない", (_label, overrides) => {
    expect(tabs([project("p", overrides)])).toEqual([]);
  });

  it.each([
    ["アーカイブ済み", { archivedAt: 5 }],
    ["削除済み", { deletedAt: 5 }],
  ] as const)("[同値分割] URLで選ばれていても%sのProjectは出さない", (_label, overrides) => {
    expect(tabs([project("p", overrides)], "p")).toEqual([]);
  });

  it("[同値分割] 完了済みでもURLで選ばれているProjectは一時的に出す", () => {
    expect(tabs([project("p", { statusId: "completed" })], "p").map((tab) => tab.id)).toEqual([
      "p",
    ]);
  });

  it("[代表値] 渡された順（Projects画面の並び順）を保つ", () => {
    expect(tabs([project("b"), project("a"), project("c")]).map((tab) => tab.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it.each([
    ["未着手", { statusId: "todo" }, 1],
    ["進行中", { statusId: "doing" }, 1],
    ["完了", { statusId: "done" }, 0],
    ["中止", { statusId: "dropped" }, 0],
    ["Status不明", { statusId: "missing" }, 1],
    ["アーカイブ済み", { archivedAt: 3 }, 0],
    ["削除済み", { deletedAt: 3 }, 0],
    ["別Project", { projectId: "other" }, 0],
  ] as const)("[デシジョンテーブル] %sのIssue → 未完了件数 %i", (_label, overrides, count) => {
    const result = selectProjectTabs({
      projects: [project("p")],
      projectStatuses,
      workflowStates,
      issues: [reviewIssue("i", { projectId: "p", ...overrides })],
      selectedProjectId: null,
    });
    expect(result[0].openCount).toBe(count);
  });
});

describe("issuesEntryProjectId", () => {
  const list = [
    { id: "a", name: "A", color: "#000", openCount: 0 },
    { id: "b", name: "B", color: "#000", openCount: 0 },
  ];
  it.each([
    ["覚えているタブがある", "b", "b"],
    ["覚えているタブが消えた", "gone", "a"],
    ["覚えていない", null, "a"],
    ["すべてを覚えている", "all", "all"],
  ] as const)("[デシジョンテーブル] %s → %s", (_label, remembered, expected) => {
    expect(issuesEntryProjectId(list, remembered)).toBe(expected);
  });

  it("[境界値] タブが0件なら「すべて」", () => {
    expect(issuesEntryProjectId([], null)).toBe("all");
  });
});

describe("countOpenIssues", () => {
  it("[代表値] Projectなしも含めて、未完了・未アーカイブのIssueを数える", () => {
    const issues = [
      reviewIssue("a", { projectId: "p", statusId: "todo" }),
      reviewIssue("b", { projectId: null, statusId: "doing" }),
      reviewIssue("c", { projectId: "p", statusId: "done" }),
      reviewIssue("d", { projectId: null, statusId: "todo", archivedAt: 1 }),
    ];
    expect(countOpenIssues(issues, workflowStates)).toBe(2);
  });
});
