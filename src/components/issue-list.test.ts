import { describe, expect, it } from "vitest";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";
import {
  beforeIssueIdForDrop,
  beforeIssueIdForMove,
  filterCompletedIssues,
  filterIssuesByProject,
  issueSortOptions,
  sortIssues,
} from "./issue-list";
import { NO_PROJECT_OPTION } from "./issue-project";

const workflowStates: WorkflowState[] = [
  {
    id: "todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted",
    color: "#888888",
    position: 0,
    isDefault: true,
  },
  {
    id: "done",
    userId: "owner",
    name: "Done",
    category: "completed",
    color: "#42a579",
    position: 1,
    isDefault: false,
  },
  {
    id: "canceled",
    userId: "owner",
    name: "Canceled",
    category: "canceled",
    color: "#888888",
    position: 2,
    isDefault: false,
  },
];

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    userId: "owner",
    number: 1,
    identifier: "TASK-1",
    title: "Issue",
    description: "",
    statusId: "todo",
    priority: "no_priority",
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
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe("Issue list controls", () => {
  it("[代表値] 選択したProjectのIssueだけを表示する", () => {
    const issues = [
      issue({ id: "project-1", projectId: "project-a" }),
      issue({ id: "project-2", projectId: "project-b" }),
      issue({ id: "unassigned", projectId: null }),
    ];

    expect(filterIssuesByProject(issues, "project-a").map((item) => item.id)).toEqual([
      "project-1",
    ]);
  });

  it("[同値分割] Projectなしと全Projectをそれぞれ絞り込める", () => {
    const issues = [
      issue({ id: "project-1", projectId: "project-a" }),
      issue({ id: "unassigned", projectId: null }),
    ];

    expect(filterIssuesByProject(issues, NO_PROJECT_OPTION).map((item) => item.id)).toEqual([
      "unassigned",
    ]);
    expect(filterIssuesByProject(issues, "all").map((item) => item.id)).toEqual([
      "project-1",
      "unassigned",
    ]);
  });

  it("filters only completed workflow states and keeps canceled issues", () => {
    const issues = [
      issue({ id: "todo-1", statusId: "todo" }),
      issue({ id: "done-1", statusId: "done" }),
      issue({ id: "canceled-1", statusId: "canceled" }),
    ];

    expect(filterCompletedIssues(issues, workflowStates, false).map((item) => item.id)).toEqual([
      "todo-1",
      "canceled-1",
    ]);
    expect(filterCompletedIssues(issues, workflowStates, true)).toEqual(issues);
  });

  it("sorts by each supported option", () => {
    const issues = [
      issue({
        id: "medium",
        identifier: "TASK-2",
        title: "Bravo",
        priority: "medium",
        dueAt: Date.UTC(2026, 9, 3),
        createdAt: 100,
        updatedAt: 300,
      }),
      issue({
        id: "urgent",
        identifier: "TASK-1",
        title: "Alpha",
        statusId: "done",
        priority: "urgent",
        dueAt: null,
        createdAt: 200,
        updatedAt: 100,
      }),
      issue({
        id: "low",
        identifier: "TASK-3",
        title: "Charlie",
        statusId: "canceled",
        priority: "low",
        dueAt: Date.UTC(2026, 9, 2),
        createdAt: 300,
        updatedAt: 200,
      }),
    ];

    expect(issueSortOptions.map((option) => option.value)).toEqual([
      "manual",
      "updated_desc",
      "updated_asc",
      "created_desc",
      "created_asc",
      "title_asc",
      "title_desc",
      "status_asc",
      "status_desc",
      "priority_desc",
      "priority_asc",
      "due_asc",
      "due_desc",
    ]);
    expect(sortIssues(issues, "updated_desc").map((item) => item.id)).toEqual([
      "medium",
      "low",
      "urgent",
    ]);
    expect(sortIssues(issues, "created_desc").map((item) => item.id)).toEqual([
      "low",
      "urgent",
      "medium",
    ]);
    expect(sortIssues(issues, "title_asc").map((item) => item.id)).toEqual([
      "urgent",
      "medium",
      "low",
    ]);
    expect(sortIssues(issues, "status_asc", workflowStates).map((item) => item.id)).toEqual([
      "medium",
      "urgent",
      "low",
    ]);
    expect(sortIssues(issues, "priority_desc").map((item) => item.id)).toEqual([
      "urgent",
      "medium",
      "low",
    ]);
    expect(sortIssues(issues, "due_asc").map((item) => item.id)).toEqual([
      "low",
      "medium",
      "urgent",
    ]);
  });

  it("[代表値] manual orderのdrop先からbeforeIssueIdを導出する", () => {
    const ordered = [issue({ id: "one" }), issue({ id: "two" }), issue({ id: "three" })];

    expect(beforeIssueIdForDrop(ordered, "three", "one")).toBe("one");
    expect(beforeIssueIdForDrop(ordered, "one", "three")).toBeNull();
    expect(beforeIssueIdForDrop(ordered, "two", "two")).toBeNull();
  });

  it("[境界値] manual orderの上下移動は先頭・末尾でNo-opになる", () => {
    const ordered = [issue({ id: "one" }), issue({ id: "two" }), issue({ id: "three" })];

    expect(beforeIssueIdForDrop(ordered, "one", "one")).toBeNull();
    expect(beforeIssueIdForDrop(ordered, "three", "three")).toBeNull();
    expect(beforeIssueIdForMove(ordered, "one", "up")).toBeNull();
    expect(beforeIssueIdForMove(ordered, "three", "down")).toBeNull();
  });

  it("[代表値] manual orderのKeyboard移動は隣接Issueの前後へ挿入する", () => {
    const ordered = [issue({ id: "one" }), issue({ id: "two" }), issue({ id: "three" })];

    expect(beforeIssueIdForMove(ordered, "two", "up")).toBe("one");
    expect(beforeIssueIdForMove(ordered, "one", "down")).toBe("three");
  });

  it("[代表値] ListとBoardで共有するmanual Orderはposition順になる", () => {
    const ordered = [
      issue({ id: "later", position: 2 }),
      issue({ id: "first", position: 0 }),
      issue({ id: "middle", position: 1 }),
    ];

    expect(sortIssues(ordered, "manual").map((item) => item.id)).toEqual([
      "first",
      "middle",
      "later",
    ]);
  });

  it("[代表値] filtered Listのdrop先はhidden Issueを含む全active順から導出する", () => {
    const allIssues = [
      issue({ id: "dragged", position: 0 }),
      issue({ id: "target", position: 1 }),
      issue({ id: "hidden", position: 2 }),
    ];

    expect(beforeIssueIdForDrop(allIssues, "dragged", "target")).toBe("hidden");
  });

  it("uses identifier as a stable tie breaker", () => {
    const issues = [
      issue({ id: "second", identifier: "TASK-2", updatedAt: 200, createdAt: 100 }),
      issue({ id: "first", identifier: "TASK-1", updatedAt: 200, createdAt: 100 }),
    ];

    expect(sortIssues(issues, "updated_desc").map((item) => item.identifier)).toEqual([
      "TASK-1",
      "TASK-2",
    ]);
  });

  it("[代表値] 更新日の古い順を選択でき、元の配列は変更しない", () => {
    const issues = [
      issue({ id: "latest", updatedAt: 300 }),
      issue({ id: "earliest", updatedAt: 100 }),
      issue({ id: "middle", updatedAt: 200 }),
    ];
    expect(sortIssues(issues, "updated_asc").map((item) => item.id)).toEqual([
      "earliest",
      "middle",
      "latest",
    ]);
    expect(issues.map((item) => item.id)).toEqual(["latest", "earliest", "middle"]);
  });

  it("[代表値] 作成日の古い順は更新日と独立して並ぶ", () => {
    const issues = [
      issue({ id: "middle", createdAt: 200, updatedAt: 300 }),
      issue({ id: "earliest", createdAt: 100, updatedAt: 200 }),
      issue({ id: "latest", createdAt: 300, updatedAt: 100 }),
    ];
    expect(sortIssues(issues, "created_asc").map((item) => item.id)).toEqual([
      "earliest",
      "middle",
      "latest",
    ]);
  });

  it("[代表値] タイトルの降順を日本語でも選択できる", () => {
    const issues = [
      issue({ id: "a", title: "あいう", updatedAt: 300 }),
      issue({ id: "sa", title: "さしす", updatedAt: 200 }),
      issue({ id: "ka", title: "かきく", updatedAt: 100 }),
    ];
    expect(sortIssues(issues, "title_desc").map((item) => item.id)).toEqual(["sa", "ka", "a"]);
  });

  it("[代表値] Statusの逆順はWorkflow positionを使う", () => {
    const issues = [
      issue({ id: "todo", statusId: "todo", updatedAt: 300 }),
      issue({ id: "done", statusId: "done", updatedAt: 200 }),
      issue({ id: "canceled", statusId: "canceled", updatedAt: 100 }),
    ];
    expect(
      sortIssues(issues, "status_desc", [
        workflowStates[1],
        workflowStates[0],
        workflowStates[2],
      ]).map((item) => item.id),
    ).toEqual(["canceled", "done", "todo"]);
  });

  it("[代表値] Priority昇順はNo priorityからUrgentまで全5段階を反転する", () => {
    const issues = ["urgent", "high", "medium", "low", "no_priority"].map((priority, index) =>
      issue({ id: priority, priority: priority as Issue["priority"], updatedAt: 500 - index }),
    );
    expect(sortIssues(issues, "priority_asc").map((item) => item.id)).toEqual([
      "no_priority",
      "low",
      "medium",
      "high",
      "urgent",
    ]);
  });

  it("[境界値] 期限の遠い順でもnullは最後で同一期限のtie順は維持する", () => {
    const issues = [
      issue({ id: "none", dueAt: null, updatedAt: 500 }),
      issue({ id: "near", dueAt: Date.UTC(2026, 9, 1), updatedAt: 400 }),
      issue({ id: "far-old", dueAt: Date.UTC(2026, 9, 3), updatedAt: 200 }),
      issue({ id: "far-new", dueAt: Date.UTC(2026, 9, 3), updatedAt: 300 }),
    ];
    expect(sortIssues(issues, "due_desc").map((item) => item.id)).toEqual([
      "far-new",
      "far-old",
      "near",
      "none",
    ]);
    expect(sortIssues(issues, "due_asc").map((item) => item.id)).toEqual([
      "near",
      "far-new",
      "far-old",
      "none",
    ]);
  });

  it.each([
    "manual",
    "updated_desc",
    "updated_asc",
    "created_desc",
    "created_asc",
    "title_asc",
    "title_desc",
    "status_asc",
    "status_desc",
    "priority_desc",
    "priority_asc",
    "due_asc",
    "due_desc",
  ] as const)("[同値分割] %sの同値は既存identifier tie順を反転しない", (sort) => {
    const issues = [
      issue({ id: "second", identifier: "TASK-2", dueAt: 1000 }),
      issue({ id: "first", identifier: "TASK-1", dueAt: 1000 }),
    ];
    expect(sortIssues(issues, sort, workflowStates).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it.each(["due_asc", "due_desc"] as const)(
    "[日付境界] %sは同UTC日non-midnightを時刻順にせず更新順でtieBreakする",
    (sort) => {
      const issues = [
        issue({ id: "evening-old", dueAt: Date.UTC(2026, 9, 2, 23, 59), updatedAt: 100 }),
        issue({ id: "morning-new", dueAt: Date.UTC(2026, 9, 2), updatedAt: 300 }),
      ];
      expect(sortIssues(issues, sort).map((item) => item.id)).toEqual([
        "morning-new",
        "evening-old",
      ]);
      expect(issues.map((item) => item.id)).toEqual(["evening-old", "morning-new"]);
    },
  );
});
