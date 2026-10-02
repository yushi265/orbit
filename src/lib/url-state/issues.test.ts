import { describe, expect, it } from "vitest";
import { normalizeIssueSearch, resolveIssueSearch } from "./issues";

describe("Issue URL search contract", () => {
  it("[代表値] 全Filter・Mode・Orderとcompletedを一覧/詳細の共通値へ復元する", () => {
    const search = normalizeIssueSearch({
      q: "  task  ",
      status: "todo",
      priority: "high",
      project: "__none__",
      label: "label-1",
      due: "today",
      scope: "archived",
      order: "manual",
      mode: "board",
      completed: false,
    });
    expect(resolveIssueSearch(search, true)).toEqual({
      filterText: "  task  ",
      statusFilter: "todo",
      priorityFilter: "high",
      projectFilter: "__none__",
      labelFilter: "label-1",
      dueFilter: "today",
      issueScope: "archived",
      issueSort: "manual",
      viewMode: "board",
      showCompleted: false,
    });
  });
  it.each([
    "manual",
    "created_desc",
    "title_asc",
    "status_asc",
    "priority_desc",
    "due_asc",
    "updated_desc",
  ])("[Enum] 既存Order=%sを受け入れる", (order) => {
    expect(normalizeIssueSearch({ order })).toEqual(order === "updated_desc" ? {} : { order });
  });
  it("[不正入力] array/object/未知key/不正Enumを安全な既定値へ正規化する", () => {
    expect(
      normalizeIssueSearch({
        q: ["abc"],
        status: {},
        priority: "highest",
        project: ["id"],
        label: {},
        due: "bad",
        scope: "trash",
        order: "other",
        mode: "table",
        completed: [false],
        unknown: "x",
      }),
    ).toEqual({});
  });
  it("[canonical] all/list/active/updated_descを省略し、completedの実効値は保持する", () => {
    expect(
      normalizeIssueSearch({
        q: "",
        status: "all",
        priority: "all",
        project: "all",
        label: "all",
        due: "all",
        scope: "active",
        order: "updated_desc",
        mode: "list",
        completed: true,
      }),
    ).toEqual({ completed: true });
  });
  it("[primitive] 数値はテキストとIDに変換し、qの入力中空白を維持する", () => {
    expect(normalizeIssueSearch({ q: 123, status: 1, project: 2, label: 3 })).toEqual({
      q: "123",
      status: "1",
      project: "2",
      label: "3",
    });
    expect(normalizeIssueSearch({ q: " " })).toEqual({ q: " " });
  });
  it.each([true, false])("[Storage fallback] completed省略時だけStorage=%sを使う", (fallback) => {
    expect(resolveIssueSearch({}, fallback).showCompleted).toBe(fallback);
    expect(resolveIssueSearch({ completed: !fallback }, fallback).showCompleted).toBe(!fallback);
  });
  it.each(["true", "false"])("[URL primitive] completed=%sをbooleanへ正規化する", (value) => {
    expect(normalizeIssueSearch({ completed: value })).toEqual({ completed: value === "true" });
  });
});
