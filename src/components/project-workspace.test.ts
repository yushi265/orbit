import { describe, expect, it } from "vitest";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";
import { defaultProjectIssueDisplaySettings } from "../shared/contracts/project-display";
import { filterProjectIssues } from "./project-workspace";

const states: WorkflowState[] = [
  {
    id: "todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted",
    color: "#888",
    position: 0,
    isDefault: true,
  },
  {
    id: "done",
    userId: "owner",
    name: "Done",
    category: "completed",
    color: "#888",
    position: 1,
    isDefault: false,
  },
  {
    id: "canceled",
    userId: "owner",
    name: "Canceled",
    category: "canceled",
    color: "#888",
    position: 2,
    isDefault: false,
  },
];

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    userId: "owner",
    number: 1,
    identifier: id,
    title: id,
    description: "",
    statusId: "todo",
    priority: "no_priority",
    estimate: null,
    dueAt: null,
    projectId: "project-1",
    cycleId: null,
    parentId: null,
    labelIds: [],
    position: 0,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("Project issue workspace filtering", () => {
  it("[デシジョンテーブル] 完了表示OFFはcompletedだけを除外し、canceledは残す", () => {
    const settings = {
      ...defaultProjectIssueDisplaySettings(),
      showCompleted: false,
      order: "manual" as const,
    };
    const result = filterProjectIssues(
      [
        issue("todo"),
        issue("done", { statusId: "done" }),
        issue("canceled", { statusId: "canceled", position: 1 }),
      ],
      "project-1",
      settings,
      states,
      1_700_000_000_000,
      "Asia/Tokyo",
    );

    expect(result.map((item) => item.id)).toEqual(["todo", "canceled"]);
  });

  it("[代表値] Project scope・Status・Priority・Label・Due・検索を同時に適用する", () => {
    const settings = {
      ...defaultProjectIssueDisplaySettings(),
      filterText: "対象",
      statusFilter: "todo",
      priorityFilter: "urgent" as const,
      labelFilter: "label-1",
      dueFilter: "today" as const,
    };
    const now = Date.UTC(2026, 7, 30, 3);
    const result = filterProjectIssues(
      [
        issue("match", {
          title: "対象Issue",
          priority: "urgent",
          labelIds: ["label-1"],
          dueAt: now,
        }),
        issue("other-project", {
          projectId: "project-2",
          title: "対象Issue",
          priority: "urgent",
          labelIds: ["label-1"],
          dueAt: now,
        }),
        issue("other-status", {
          title: "対象Issue",
          priority: "urgent",
          labelIds: ["label-1"],
          dueAt: now,
          statusId: "done",
        }),
      ],
      "project-1",
      settings,
      states,
      now,
      "Asia/Tokyo",
    );

    expect(result.map((item) => item.id)).toEqual(["match"]);
  });

  it("[同値分割] active workspaceからarchived / deleted Issueを除外する", () => {
    const result = filterProjectIssues(
      [issue("active"), issue("archived", { archivedAt: 2 }), issue("deleted", { deletedAt: 2 })],
      "project-1",
      defaultProjectIssueDisplaySettings(),
      states,
      1_700_000_000_000,
      "Asia/Tokyo",
    );

    expect(result.map((item) => item.id)).toEqual(["active"]);
  });
});
