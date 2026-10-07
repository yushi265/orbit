import type { IssueListScope } from "../../shared/contracts";

// TanStack Query のキーはここでだけ作る。形状は既存テストがキャッシュを仕込む形と同じに保つ。
export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  issues: (scope: IssueListScope) => ["issues", scope] as const,
  issueDetail: (id: string) => ["issue-detail", id] as const,
  recent: ["recent"] as const,
  // 前方一致で 3 scope の一覧をまとめて invalidate する
  issuesAll: ["issues"] as const,
};
