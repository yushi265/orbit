import type {
  BootstrapViewModel,
  CycleViewModel as Cycle,
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";
import { calculateCycleMetrics, type CycleMetrics } from "../shared/cycle-workspace";
import { sortIssues } from "./issue-list";

export interface HomeSummary {
  activeCycle: Cycle | null;
  overdue: Issue[];
  dueToday: Issue[];
  dueSoon: Issue[];
  currentCycleIssues: Issue[];
  recentIssues: Issue[];
  cycleMetrics: CycleMetrics;
  openIssueCount: number;
  activeProjectCount: number;
}

function dateParts(value: number, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function dateKeyInTimeZone(value: number, timeZone: string): string {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return dateKeyInTimeZone(Date.UTC(year, month - 1, day + days), "UTC");
}

function issueCategory(issue: Issue, workflowStates: readonly WorkflowState[]): string | undefined {
  return workflowStates.find((state) => state.id === issue.statusId)?.category;
}

function isOpenIssue(issue: Issue, workflowStates: readonly WorkflowState[]): boolean {
  const category = issueCategory(issue, workflowStates);
  return category !== "completed" && category !== "canceled";
}

function sortByDue(issues: readonly Issue[]): Issue[] {
  return sortIssues(issues, "due_asc");
}

export function buildHomeSummary(data: BootstrapViewModel, now: number): HomeSummary {
  const timezone = data.preferences.timezone;
  const today = dateKeyInTimeZone(now, timezone);
  const sevenDaysLater = addCalendarDays(today, 7);
  const activeIssues = data.issues.filter((issue) => !issue.archivedAt && !issue.deletedAt);
  const openIssues = activeIssues.filter((issue) => isOpenIssue(issue, data.workflowStates));
  const withDueDate = openIssues.filter((issue) => issue.dueAt !== null);
  const overdue = sortByDue(
    withDueDate.filter((issue) => dateKeyInTimeZone(issue.dueAt!, timezone) < today),
  );
  const dueToday = sortByDue(
    withDueDate.filter((issue) => dateKeyInTimeZone(issue.dueAt!, timezone) === today),
  );
  const dueSoon = sortByDue(
    withDueDate.filter((issue) => {
      const due = dateKeyInTimeZone(issue.dueAt!, timezone);
      return due > today && due <= sevenDaysLater;
    }),
  );
  const activeCycle = data.cycles.find((cycle) => cycle.status === "active") ?? null;
  const currentCycleIssues = activeCycle
    ? sortByDue(
        openIssues.filter((issue) => issue.cycleId === activeCycle.id && issue.dueAt !== null),
      ).concat(
        sortIssues(
          openIssues.filter((issue) => issue.cycleId === activeCycle.id && issue.dueAt === null),
          "updated_desc",
        ),
      )
    : [];
  const cycleAllIssues = activeCycle
    ? activeIssues.filter((issue) => issue.cycleId === activeCycle.id)
    : [];

  return {
    activeCycle,
    overdue,
    dueToday,
    dueSoon,
    currentCycleIssues,
    recentIssues: sortIssues(activeIssues, "updated_desc").slice(0, 6),
    cycleMetrics: calculateCycleMetrics(cycleAllIssues, data.workflowStates),
    openIssueCount: openIssues.length,
    activeProjectCount: data.projects.filter((project) => !project.archivedAt && !project.deletedAt)
      .length,
  };
}

export function homeDateLabel(value: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone,
  }).format(new Date(value));
}

export function homeRelativeDay(value: number, now: number, timeZone: string): string {
  const valueKey = dateKeyInTimeZone(value, timeZone);
  const todayKey = dateKeyInTimeZone(now, timeZone);
  if (valueKey < todayKey) return "期限超過";
  if (valueKey === todayKey) return "今日";
  if (valueKey <= addCalendarDays(todayKey, 7)) return "7日以内";
  return "今後";
}
