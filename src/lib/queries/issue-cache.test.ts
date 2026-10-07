import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { IssueListScope } from "../../shared/contracts";
import type { IssueViewModel as Issue } from "../../shared/view-models";
import {
  reviewBootstrap,
  reviewDetail,
  reviewIssue,
} from "../../components/review-ui.test-fixtures";
import { queryKeys } from "./keys";
import { removeIssueFromCaches, syncIssueCaches } from "./issue-cache";

const SCOPES = ["active", "archived", "trash"] as const;
const lifecycle = {
  active: { archivedAt: null, deletedAt: null },
  archived: { archivedAt: 100, deletedAt: null },
  trash: { archivedAt: null, deletedAt: 200 },
} as const;

const others = {
  active: reviewIssue("other-active"),
  archived: reviewIssue("other-archived", lifecycle.archived),
  trash: reviewIssue("other-trash", lifecycle.trash),
};

// 全キャッシュを作った状態から始める。target を before の scope に置く。
function seededClient(target: Issue, before: IssueListScope) {
  const client = new QueryClient();
  const bootstrapIssues = before === "active" ? [others.active, target] : [others.active];
  client.setQueryData(queryKeys.bootstrap, reviewBootstrap(bootstrapIssues));
  for (const scope of SCOPES)
    client.setQueryData(queryKeys.issues(scope), {
      items: scope === before ? [others[scope], target] : [others[scope]],
    });
  client.setQueryData(queryKeys.issueDetail(target.id), reviewDetail(target));
  return client;
}

const ids = (items: readonly Issue[] | undefined) => items?.map((item) => item.id);
const scopeIds = (client: QueryClient, scope: IssueListScope) =>
  ids(client.getQueryData<{ items: Issue[] }>(queryKeys.issues(scope))?.items);
const bootstrapIds = (client: QueryClient) =>
  ids(client.getQueryData<ReturnType<typeof reviewBootstrap>>(queryKeys.bootstrap)?.issues);

function expectOnlyIn(client: QueryClient, id: string, scope: IssueListScope) {
  for (const other of SCOPES)
    expect(scopeIds(client, other)).toEqual(
      other === scope ? [others[other].id, id] : [others[other].id],
    );
  expect(bootstrapIds(client)).toEqual(
    scope === "active" ? [others.active.id, id] : [others.active.id],
  );
}

describe("queryKeys", () => {
  it("[代表値] 各キーが現行のリテラルと同じ形状", () => {
    expect(queryKeys.bootstrap).toEqual(["bootstrap"]);
    expect(queryKeys.issues("archived")).toEqual(["issues", "archived"]);
    expect(queryKeys.issueDetail("issue-1")).toEqual(["issue-detail", "issue-1"]);
    expect(queryKeys.recent).toEqual(["recent"]);
    expect(queryKeys.issuesAll).toEqual(["issues"]);
  });
});

describe("syncIssueCaches", () => {
  it.each([
    { archivedAt: null, deletedAt: null, scope: "active" },
    { archivedAt: 100, deletedAt: null, scope: "archived" },
    { archivedAt: null, deletedAt: 200, scope: "trash" },
    { archivedAt: 100, deletedAt: 200, scope: "trash" },
  ] as const)(
    "[デシジョンテーブル] archivedAt=$archivedAt, deletedAt=$deletedAt → $scope にだけ所属する",
    ({ archivedAt, deletedAt, scope }) => {
      const original = reviewIssue("target");
      const client = seededClient(original, "active");
      const updated = { ...original, archivedAt, deletedAt, version: 2 };
      syncIssueCaches(client, updated);
      expectOnlyIn(client, "target", scope);
      expect(
        client.getQueryData<ReturnType<typeof reviewDetail>>(queryKeys.issueDetail("target"))
          ?.issue,
      ).toEqual(updated);
    },
  );

  it.each(SCOPES.flatMap((before) => SCOPES.map((after) => ({ before, after }))))(
    "[状態遷移] $before → $after: 旧 scope から消え、新 scope にだけ存在する",
    ({ before, after }) => {
      const original = reviewIssue("target", lifecycle[before]);
      const client = seededClient(original, before);
      const updated = { ...original, ...lifecycle[after], title: "updated", version: 2 };
      syncIssueCaches(client, updated);
      expectOnlyIn(client, "target", after);
      const items = client.getQueryData<{ items: Issue[] }>(queryKeys.issues(after))!.items;
      expect(items.find((item) => item.id === "target")).toEqual(updated);
    },
  );

  it("[同値分割] キャッシュ未作成（bootstrap / scope / detail なし）→ 未作成のキャッシュは作らない", () => {
    const client = new QueryClient();
    syncIssueCaches(client, reviewIssue("target"));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("[同値分割] キャッシュに無い Issue → 所属 scope と bootstrap（active）の末尾に追加される", () => {
    const client = seededClient(reviewIssue("unrelated"), "trash");
    syncIssueCaches(client, reviewIssue("target"));
    expect(scopeIds(client, "active")).toEqual(["other-active", "target"]);
    expect(bootstrapIds(client)).toEqual(["other-active", "target"]);
    expect(scopeIds(client, "archived")).toEqual(["other-archived"]);
    expect(scopeIds(client, "trash")).toEqual(["other-trash", "unrelated"]);
  });

  it("[代表値] 一覧の他の項目とキャッシュのメタデータを保持する", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.issues("active"), {
      items: [others.active, reviewIssue("target")],
      marker: "kept",
    });
    syncIssueCaches(client, { ...reviewIssue("target"), title: "updated" });
    expect(client.getQueryData(queryKeys.issues("active"))).toEqual({
      items: [others.active, { ...reviewIssue("target"), title: "updated" }],
      marker: "kept",
    });
  });
});

describe("removeIssueFromCaches", () => {
  it("[代表値] bootstrap と 3 scope から消え、detail キャッシュが削除される", () => {
    const target = reviewIssue("target");
    const client = seededClient(target, "active");
    client.setQueryData(queryKeys.issues("trash"), { items: [others.trash, target] });
    removeIssueFromCaches(client, "target");
    for (const scope of SCOPES) expect(scopeIds(client, scope)).toEqual([others[scope].id]);
    expect(bootstrapIds(client)).toEqual(["other-active"]);
    expect(client.getQueryState(queryKeys.issueDetail("target"))).toBeUndefined();
  });
});
