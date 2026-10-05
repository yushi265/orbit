import { describe, expect, it } from "vitest";
import { buildHomeSummary, homeDateLabel } from "./home";
import type { BootstrapViewModel } from "../shared/view-models";

const now = Date.UTC(2026, 7, 30, 3);
const states = [
  {
    id: "todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted" as const,
    color: "#888",
    position: 0,
    isDefault: true,
  },
  {
    id: "done",
    userId: "owner",
    name: "Done",
    category: "completed" as const,
    color: "#888",
    position: 1,
    isDefault: false,
  },
  {
    id: "canceled",
    userId: "owner",
    name: "Canceled",
    category: "canceled" as const,
    color: "#888",
    position: 2,
    isDefault: false,
  },
];

function issue(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "owner",
    number: Number(id.replace("issue-", "")) || 1,
    identifier: `TASK-${id.replace("issue-", "")}`,
    title: id,
    description: "",
    statusId: "todo",
    priority: "no_priority" as const,
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

function data(issues: ReturnType<typeof issue>[]): BootstrapViewModel {
  return {
    me: { id: "owner", name: "太郎", email: "taro@example.com", avatarUrl: null, createdAt: now },
    preferences: {
      userId: "owner",
      timezone: "Asia/Tokyo",
      locale: "ja",
      theme: "system",
      colorTheme: "coral",
      estimateEnabled: true,
      issueCounter: 4,
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
    projectStatuses: [],
    issues,
    labels: [],
    projects: [
      {
        id: "project-1",
        userId: "owner",
        name: "Project",
        statusId: "project-status",
        priority: "high",
        color: "#f00",
        icon: "◈",
        description: "",
        startAt: null,
        targetAt: null,
        archivedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        position: 0,
      },
    ],
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
    projectDisplayPreferences: [],
    background: { run: null },
  };
}

describe("Home summary", () => {
  it("[デシジョンテーブル] 期限超過・今日・7日以内を分け、完了系を作業対象から除外する", () => {
    const day = 24 * 60 * 60 * 1000;
    const issues = [
      issue("issue-1", { dueAt: now - day }),
      issue("issue-2", { dueAt: now }),
      issue("issue-3", { dueAt: now + 3 * day }),
      issue("issue-7", { dueAt: now + 7 * day }),
      issue("issue-4", { dueAt: now + 8 * day }),
      issue("issue-no-due", { dueAt: null }),
      issue("issue-5", { statusId: "done", dueAt: now - day }),
      issue("issue-6", { statusId: "canceled", dueAt: now - day }),
    ];

    const summary = buildHomeSummary(data(issues), now);

    expect(summary.overdue.map((item) => item.id)).toEqual(["issue-1"]);
    expect(summary.dueToday.map((item) => item.id)).toEqual(["issue-2"]);
    expect(summary.dueSoon.map((item) => item.id)).toEqual(["issue-3", "issue-7"]);
    expect(summary.currentCycleIssues.map((item) => item.id)).toEqual([
      "issue-1",
      "issue-2",
      "issue-3",
      "issue-7",
      "issue-4",
      "issue-no-due",
    ]);
    expect(summary.openIssueCount).toBe(6);
  });

  it("[代表値] 最近更新はupdatedAt降順で選び、表示名とTimezone日付を提供する", () => {
    const summary = buildHomeSummary(
      data([
        issue("issue-1", { updatedAt: 10 }),
        issue("issue-2", { updatedAt: 30 }),
        issue("issue-3", { updatedAt: 20 }),
      ]),
      now,
    );

    expect(summary.recentIssues.map((item) => item.id)).toEqual(["issue-2", "issue-3", "issue-1"]);
    expect(homeDateLabel(now, "Asia/Tokyo")).toContain("8月30日");
  });

  it("[境界値] UTC期限日と本人todayの境界・7日目・8日目を分類する", () => {
    const boundary = buildHomeSummary(
      data([
        issue("before-midnight", { dueAt: Date.UTC(2026, 7, 29, 23, 59) }),
        issue("at-midnight", { dueAt: Date.UTC(2026, 7, 30) }),
        issue("day-seven", { dueAt: Date.UTC(2026, 8, 6, 23, 59) }),
        issue("day-eight", { dueAt: Date.UTC(2026, 8, 7) }),
      ]),
      now,
    );

    expect(boundary.overdue.map((item) => item.id)).toEqual(["before-midnight"]);
    expect(boundary.dueToday.map((item) => item.id)).toEqual(["at-midnight"]);
    expect(boundary.dueSoon.map((item) => item.id)).toEqual(["day-seven"]);
    expect(boundary.dueSoon.map((item) => item.id)).not.toContain("day-eight");
  });
});
