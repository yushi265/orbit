import type {
  BootstrapViewModel,
  IssueViewModel,
  IssueDetailViewModel,
} from "../shared/view-models";

export function reviewIssue(
  id = "issue-1",
  overrides: Partial<IssueViewModel> = {},
): IssueViewModel {
  return {
    id,
    userId: "owner",
    number: 1,
    identifier: `TASK-${id}`,
    title: id,
    description: "",
    statusId: "todo",
    priority: "high",
    estimate: null,
    dueAt: null,
    projectId: "project-1",
    cycleId: null,
    parentId: null,
    labelIds: ["label-1"],
    position: 0,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
export function reviewBootstrap(issues = [reviewIssue()]): BootstrapViewModel {
  return {
    me: { id: "owner", name: "Owner", email: "owner@example.com", avatarUrl: null, createdAt: 1 },
    preferences: {
      userId: "owner",
      timezone: "Asia/Tokyo",
      locale: "ja",
      theme: "light",
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
    workflowStates: [
      {
        id: "todo",
        userId: "owner",
        name: "Todo",
        category: "unstarted",
        color: "#888888",
        position: 0,
        isDefault: true,
      },
    ],
    projectStatuses: [
      {
        id: "project-status",
        userId: "owner",
        name: "In progress",
        category: "in_progress",
        color: "#888888",
        position: 0,
        isDefault: true,
      },
    ],
    issues,
    labels: [{ id: "label-1", userId: "owner", name: "Label 1", color: "#888888" }],
    projects: [
      {
        id: "project-1",
        userId: "owner",
        name: "Project 1",
        statusId: "project-status",
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
      },
    ],
    projectDisplayPreferences: [],
    cycles: [],
    cycleHistory: [],
    views: [],
    notifications: [],
    background: { run: null },
  };
}
export function reviewDetail(issue = reviewIssue()): IssueDetailViewModel {
  return {
    issue,
    parent: null,
    children: [],
    childProgress: { total: 0, completed: 0, canceled: 0, progressPercent: 0 },
    notes: [],
    relations: [],
    activity: [],
    cycleHistory: [],
    carryoverCount: 0,
  };
}
