import { describe, expect, it } from "vitest";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";
import {
  beforeIssueIdForDrop,
  beforeIssueIdForMove,
  filterCompletedIssues,
  issueSortOptions,
  sortIssues,
} from "./issue-list";

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
        dueAt: 300,
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
        dueAt: 200,
        createdAt: 300,
        updatedAt: 200,
      }),
    ];

    expect(issueSortOptions.map((option) => option.value)).toEqual([
      "manual",
      "updated_desc",
      "created_desc",
      "title_asc",
      "status_asc",
      "priority_desc",
      "due_asc",
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
});
