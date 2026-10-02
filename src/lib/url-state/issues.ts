import { PRIORITY_VALUES, type Priority } from "../../shared/contracts";
import { issueSortOptions, type IssueSort, type IssueDueFilter } from "../../components/issue-list";

export type IssueSearch = {
  q?: string;
  status?: string;
  priority?: Priority;
  project?: string;
  label?: string;
  due?: Exclude<IssueDueFilter, "all">;
  scope?: "archived";
  order?: IssueSort;
  mode?: "board";
  completed?: boolean;
  open?: true;
};
function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : undefined;
}
export function normalizeIssueSearch(input: Record<string, unknown>): IssueSearch {
  const result: IssueSearch = {};
  const q = scalar(input.q);
  if (q) result.q = q;
  for (const key of ["status", "project", "label"] as const) {
    const value = scalar(input[key]);
    if (value && value !== "all") result[key] = value;
  }
  const priority = choice(input.priority, PRIORITY_VALUES);
  if (priority) result.priority = priority;
  const due = choice(input.due, ["none", "overdue", "today", "upcoming", "next7"] as const);
  if (due) result.due = due;
  if (input.scope === "archived") result.scope = "archived";
  const order = choice(
    input.order,
    issueSortOptions.map((option) => option.value),
  );
  if (order && order !== "updated_desc") result.order = order;
  if (input.mode === "board") result.mode = "board";
  if (input.completed === true || input.completed === "true") result.completed = true;
  if (input.completed === false || input.completed === "false") result.completed = false;
  if (input.open === true || input.open === "true") result.open = true;
  return result;
}
export function resolveIssueSearch(search: IssueSearch, completedFallback: boolean) {
  return {
    filterText: search.q ?? "",
    statusFilter: search.status ?? "all",
    priorityFilter: search.priority ?? ("all" as const),
    projectFilter: search.project ?? "all",
    labelFilter: search.label ?? "all",
    dueFilter: search.due ?? ("all" as const),
    issueScope: search.scope ?? ("active" as const),
    issueSort: search.order ?? ("updated_desc" as const),
    viewMode: search.mode ?? ("list" as const),
    showCompleted: search.completed ?? completedFallback,
  };
}

export type ProjectSearch = { active?: true };
export function normalizeProjectSearch(input: Record<string, unknown>): ProjectSearch {
  return input.active === true || input.active === "true" ? { active: true } : {};
}
