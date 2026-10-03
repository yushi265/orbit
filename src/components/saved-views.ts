import type { IssueQuery } from "../shared/contracts/issues";
import type { IssueViewModel as Issue } from "../shared/view-models";
import { matchesIssueDueDate } from "../shared/issue-dates";

export type ViewSearch = { view?: string };
export function normalizeViewSearch(input: Record<string, unknown>): ViewSearch {
  return typeof input.view === "string" && input.view.trim() ? { view: input.view } : {};
}
export function updateSavedViewQuery(query: IssueQuery, patch: Partial<IssueQuery>): IssueQuery {
  return { ...query, ...patch };
}
export function selectSavedViewIssues(
  issues: readonly Issue[],
  query: IssueQuery,
  now: number,
  timezone: string,
): Issue[] {
  const filter = query.filter;
  const needle = filter.text?.trim().toLocaleLowerCase();
  const ranks = ["no_priority", "low", "medium", "high", "urgent"];
  return issues
    .filter(
      (issue) =>
        !issue.archivedAt &&
        !issue.deletedAt &&
        (!needle ||
          `${issue.identifier} ${issue.title} ${issue.description}`
            .toLocaleLowerCase()
            .includes(needle)) &&
        (!filter.statusIds?.length || filter.statusIds.includes(issue.statusId)) &&
        (!filter.priorities?.length || filter.priorities.includes(issue.priority)) &&
        (!filter.projectIds?.length ||
          Boolean(issue.projectId && filter.projectIds.includes(issue.projectId))) &&
        (!filter.cycleIds?.length ||
          Boolean(issue.cycleId && filter.cycleIds.includes(issue.cycleId))) &&
        (!filter.labelIds?.length || filter.labelIds.every((id) => issue.labelIds.includes(id))) &&
        (filter.created?.from === undefined || issue.createdAt >= filter.created.from) &&
        (filter.created?.to === undefined || issue.createdAt <= filter.created.to) &&
        (!filter.due || matchesIssueDueDate(issue.dueAt, filter.due, now, timezone)),
    )
    .sort((a, b) => {
      switch (query.order) {
        case "priority":
          return ranks.indexOf(a.priority) - ranks.indexOf(b.priority) || b.updatedAt - a.updatedAt;
        case "updated":
          return b.updatedAt - a.updatedAt;
        case "created":
          return b.createdAt - a.createdAt;
        case "due_at":
          return (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
        case "estimate":
          return (b.estimate ?? 0) - (a.estimate ?? 0);
        default:
          return a.position - b.position;
      }
    })
    .slice(0, Math.min(Math.max(query.limit, 1), 500));
}
type Named = { id: string; name: string };
type GroupSources = {
  workflowStates: Named[];
  projects: Named[];
  cycles: Named[];
  labels: Named[];
};
export function groupSavedViewIssues(
  issues: Issue[],
  query: Pick<IssueQuery, "group" | "showEmptyGroups">,
  sources: GroupSources,
): Array<Named & { issues: Issue[] }> {
  const group = query.group;
  if (!group) return [{ id: "all", name: "Issues", issues }];
  const options: Named[] =
    group === "priority"
      ? ["urgent", "high", "medium", "low", "no_priority"].map((id) => ({ id, name: id }))
      : group === "status"
        ? sources.workflowStates
        : group === "project"
          ? sources.projects
          : group === "cycle"
            ? sources.cycles
            : sources.labels;
  const knownIds = new Set(options.map((option) => option.id));
  const ids = (issue: Issue): string[] =>
    group === "status"
      ? [issue.statusId]
      : group === "priority"
        ? [issue.priority]
        : group === "project"
          ? [issue.projectId ?? "none"]
          : group === "cycle"
            ? [issue.cycleId ?? "none"]
            : issue.labelIds.length
              ? issue.labelIds
              : ["none"];
  const missing = [...new Set(issues.flatMap(ids))].filter((id) => !knownIds.has(id));
  return [...options, ...missing.map((id) => ({ id, name: id === "none" ? "未設定" : id }))]
    .map((option) => ({
      ...option,
      issues: issues.filter((issue) => ids(issue).includes(option.id)),
    }))
    .filter((option) => query.showEmptyGroups || option.issues.length > 0);
}
