import { describe, expect, it } from "vitest";
import type { WorkflowStateViewModel } from "../shared/view-models";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";
import { selectInboxIssues } from "./inbox-triage";
import { reviewIssue } from "./review-ui.test-fixtures";

// FEAT-inbox-triage AC-1: Projectなし かつ 完了・キャンセル以外を作成日時の新しい順に出す。

function state(id: string, category: WorkflowStateViewModel["category"]): WorkflowStateViewModel {
  return {
    id,
    userId: "owner",
    name: id,
    category,
    color: "#888888",
    position: 0,
    isDefault: false,
  };
}
const states = [
  state("backlog", "backlog"),
  state("todo", "unstarted"),
  state("doing", "started"),
  state("done", "completed"),
  state("canceled", "canceled"),
];

describe("selectInboxIssues", () => {
  it.each([
    ["Projectなし × backlog", null, "backlog", true],
    ["Projectなし × unstarted", null, "todo", true],
    ["Projectなし × started", null, "doing", true],
    ["Projectなし × completed", null, "done", false],
    ["Projectなし × canceled", null, "canceled", false],
    ["Projectあり × unstarted", "project-1", "todo", false],
    ["Projectあり × completed", "project-1", "done", false],
    ["Projectなし × Status不明", null, "missing", true],
  ] as const)("[デシジョンテーブル] %s → 含む=%s", (_label, projectId, statusId, included) => {
    const issue = reviewIssue("issue-1", { projectId, statusId });
    expect(selectInboxIssues([issue], states)).toEqual(included ? [issue] : []);
  });

  it("[代表値] 作成日時の新しい順に並ぶ", () => {
    const older = reviewIssue("older", { projectId: null, createdAt: 10 });
    const newest = reviewIssue("newest", { projectId: null, createdAt: 30 });
    const middle = reviewIssue("middle", { projectId: null, createdAt: 20 });
    expect(selectInboxIssues([older, newest, middle], states).map((item) => item.id)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });

  it("[境界値] 空配列は空配列", () => {
    expect(selectInboxIssues([], states)).toEqual([]);
  });
});

describe("Inbox振り分け一覧のレスポンシブ", () => {
  const selector = ".issue-table.inbox-triage-list .issue-row .project-cell";
  it.each(["(max-width: 1023px)"])(
    "[境界値] %s でもProjectセレクトを隠さず、行の2段目（期限より上）に出す",
    (media) => {
      const declarations = declarationsFor(parseStyleRules(), selector, media);
      expect(declarations.get("display")).toBe("flex");
      expect(declarations.get("grid-column")).toBe("2 / -1");
      expect(declarations.get("grid-row")).toBe("2");
      expect(
        declarationsFor(
          parseStyleRules(),
          ".issue-table.inbox-triage-list .issue-row .due-cell",
          media,
        ).get("grid-row"),
      ).toBe("3");
    },
  );
});
