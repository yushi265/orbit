import type { IssueQuery } from "../shared/contracts/issues";
import { describe, expect, it } from "vitest";
import { OrbitStore } from "../server/store";
import { reviewIssue } from "./review-ui.test-fixtures";
import {
  selectSavedViewIssues,
  groupSavedViewIssues,
  normalizeViewSearch,
  updateSavedViewQuery,
} from "./saved-views";

describe("Saved View query execution", () => {
  it("[条件組合せ] each canonical filter and all orders discriminate independent fixtures", () => {
    const day = 86_400_000;
    const today = Date.UTC(2026, 9, 3);
    const now = today + 23 * 3_600_000;
    const store = new OrbitStore(() => now);
    store.ensureOwner("owner", "owner@example.com");
    store.preferences.get("owner")!.timezone = "UTC";
    const definitions = [
      {
        title: "A alpha",
        statusId: "started",
        priority: "high",
        projectId: "p1",
        cycleId: "c1",
        labelIds: ["l1", "l2"],
        createdAt: now - 3 * day,
        updatedAt: 1,
        dueAt: today,
        estimate: 8,
        position: 3,
      },
      {
        title: "B beta",
        statusId: "todo",
        priority: "low",
        projectId: "p2",
        cycleId: "c2",
        labelIds: ["l1"],
        createdAt: now - day,
        updatedAt: 4,
        dueAt: today + day,
        estimate: 1,
        position: 2,
      },
      {
        title: "C alpha",
        statusId: "started",
        priority: "urgent",
        projectId: "p1",
        cycleId: "c2",
        labelIds: ["l2"],
        createdAt: now - 2 * day,
        updatedAt: 2,
        dueAt: today - day,
        estimate: 5,
        position: 1,
      },
      {
        title: "D delta",
        statusId: "todo",
        priority: "no_priority",
        projectId: null,
        cycleId: null,
        labelIds: [],
        createdAt: now,
        updatedAt: 3,
        dueAt: null,
        estimate: null,
        position: 0,
      },
    ];
    const items = definitions.map((definition, index) => {
      const issue = store.createIssue("owner", {
        title: definition.title,
        idempotencyKey: `issue-${index}`,
      });
      Object.assign(issue, definition);
      return issue;
    });
    for (const [id, overrides] of [
      ["archived", { archivedAt: now }],
      ["deleted", { deletedAt: now }],
    ] as const) {
      store.issues.set(id, { ...items[0], id, ...overrides });
    }
    const issues = [...store.issues.values()];
    const base = {
      mode: "list" as const,
      filter: {},
      order: "manual" as const,
      layout: {},
      showEmptyGroups: false,
      limit: 100,
    };
    const names = (result: typeof items) => result.map((item) => item.title[0]).join("");
    const cases: Array<[IssueQuery["filter"], string]> = [
      [{}, "DCBA"],
      [{ text: "alpha" }, "CA"],
      [{ statusIds: ["started"] }, "CA"],
      [{ priorities: ["high", "low"] }, "BA"],
      [{ projectIds: ["p1"] }, "CA"],
      [{ cycleIds: ["c2"] }, "CB"],
      [{ labelIds: ["l1", "l2"] }, "A"],
      [{ created: { from: now - 2 * day, to: now - day } }, "CB"],
      [{ due: "today" }, "A"],
      [{ due: "none" }, "D"],
      [{ due: "overdue" }, "C"],
      [
        {
          text: "alpha",
          statusIds: ["started"],
          priorities: ["high"],
          projectIds: ["p1"],
          cycleIds: ["c1"],
          labelIds: ["l1", "l2"],
        },
        "A",
      ],
    ];
    for (const [filter, expected] of cases) {
      const query = { ...base, filter };
      expect(names(selectSavedViewIssues(issues, query, now, "UTC"))).toBe(expected);
      expect(names(store.listIssues("owner", query))).toBe(expected);
    }
    for (const [order, expected] of [
      ["manual", "DCBA"],
      ["priority", "DBAC"],
      ["updated", "BDCA"],
      ["created", "DBCA"],
      ["due_at", "CABD"],
      ["estimate", "ACBD"],
    ] as const) {
      const query = { ...base, order };
      expect(names(selectSavedViewIssues(issues, query, now, "UTC"))).toBe(expected);
      expect(names(store.listIssues("owner", query))).toBe(expected);
      expect(names(selectSavedViewIssues(issues, { ...query, limit: 2 }, now, "UTC"))).toBe(
        expected.slice(0, 2),
      );
    }
    expect(
      names(
        selectSavedViewIssues(issues, { ...base, filter: { due: "today" } }, now, "Asia/Tokyo"),
      ),
    ).toBe("B");
  });
  it("[保存境界] editing a field preserves advanced query metadata", () => {
    const query = {
      mode: "board" as const,
      filter: { projectIds: ["p1", "p2"], labelIds: ["l1", "l2"], created: { from: 3 } },
      group: "label" as const,
      layout: { dueAt: false },
      showEmptyGroups: true,
      order: "estimate" as const,
      limit: 7,
      cursor: "cursor",
    };
    expect(updateSavedViewQuery(query, { mode: "list" })).toEqual({ ...query, mode: "list" });
    expect(
      updateSavedViewQuery(query, { filter: { ...query.filter, text: "changed" } }).filter,
    ).toEqual({ ...query.filter, text: "changed" });
  });
  it("[URL境界] selected View can be restored and malformed values are ignored", () => {
    expect(normalizeViewSearch({ view: "view-1", extra: 2 })).toEqual({ view: "view-1" });
    expect(normalizeViewSearch({ view: [] })).toEqual({});
  });
  it("[limit境界] keeps at least one and caps saved results at 500", () => {
    const items = Array.from({ length: 501 }, (_, n) => reviewIssue(String(n), { position: n }));
    const query: IssueQuery = {
      mode: "list",
      filter: {},
      order: "manual",
      layout: {},
      showEmptyGroups: false,
      limit: 100,
    };
    for (const [limit, length] of [
      [0, 1],
      [1, 1],
      [500, 500],
      [501, 500],
    ]) {
      expect(selectSavedViewIssues(items, { ...query, limit }, 1, "UTC")).toHaveLength(length);
    }
  });
  it("[Label group] a multi-label Issue belongs to each group and empty groups are optional", () => {
    const item = reviewIssue("multi", { labelIds: ["a", "b"] });
    const sources = {
      workflowStates: [],
      projects: [],
      cycles: [],
      labels: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "empty", name: "Empty" },
      ],
    };
    const groups = groupSavedViewIssues(
      [item],
      { group: "label", showEmptyGroups: false },
      sources,
    );
    expect(groups.map((g) => [g.id, g.issues.map((i) => i.id)])).toEqual([
      ["a", [item.id]],
      ["b", [item.id]],
    ]);
    expect(
      groupSavedViewIssues([item], { group: "label", showEmptyGroups: true }, sources).at(-1),
    ).toEqual({ id: "empty", name: "Empty", issues: [] });
  });
  it("[Group境界] label groups include each matching label and empty groups", () => {
    const groups = groupSavedViewIssues(
      [],
      { group: "label", showEmptyGroups: true },
      {
        workflowStates: [],
        projects: [],
        cycles: [],
        labels: [{ id: "label", name: "Important" }],
      },
    );
    expect(groups).toEqual([{ id: "label", name: "Important", issues: [] }]);
  });
});
