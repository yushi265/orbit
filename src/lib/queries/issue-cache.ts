import type { QueryClient } from "@tanstack/react-query";
import type { IssueListScope } from "../../shared/contracts";
import type {
  BootstrapViewModel,
  IssueDetailViewModel,
  IssueViewModel as Issue,
} from "../../shared/view-models";
import { queryKeys } from "./keys";

const SCOPES = ["active", "archived", "trash"] as const satisfies readonly IssueListScope[];
type IssueList = { items: Issue[] };

function scopeOf(issue: Issue): IssueListScope {
  if (issue.deletedAt !== null) return "trash";
  return issue.archivedAt !== null ? "archived" : "active";
}

function withIssue(items: Issue[], updated: Issue, belongs: boolean): Issue[] {
  const exists = items.some((item) => item.id === updated.id);
  if (!belongs) return exists ? items.filter((item) => item.id !== updated.id) : items;
  return exists
    ? items.map((item) => (item.id === updated.id ? updated : item))
    : [...items, updated];
}

// Issue 更新の唯一の反映口。存在するキャッシュだけを更新し、所属 scope 以外からは除く。
export function syncIssueCaches(queryClient: QueryClient, updated: Issue): void {
  const scope = scopeOf(updated);
  queryClient.setQueryData<BootstrapViewModel>(queryKeys.bootstrap, (current) =>
    current
      ? { ...current, issues: withIssue(current.issues, updated, scope === "active") }
      : current,
  );
  for (const listScope of SCOPES)
    queryClient.setQueryData<IssueList>(queryKeys.issues(listScope), (current) =>
      current
        ? { ...current, items: withIssue(current.items, updated, listScope === scope) }
        : current,
    );
  queryClient.setQueryData<IssueDetailViewModel>(queryKeys.issueDetail(updated.id), (current) =>
    current ? { ...current, issue: updated } : current,
  );
}

export function removeIssueFromCaches(queryClient: QueryClient, issueId: string): void {
  const without = (items: Issue[]) => items.filter((item) => item.id !== issueId);
  queryClient.setQueryData<BootstrapViewModel>(queryKeys.bootstrap, (current) =>
    current ? { ...current, issues: without(current.issues) } : current,
  );
  for (const scope of SCOPES)
    queryClient.setQueryData<IssueList>(queryKeys.issues(scope), (current) =>
      current ? { ...current, items: without(current.items) } : current,
    );
  queryClient.removeQueries({ queryKey: queryKeys.issueDetail(issueId) });
}
