import type { Priority } from "../shared/contracts";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";

export type IssueSort = "updated_desc" | "created_desc" | "title_asc" | "priority_desc" | "due_asc";

export const issueSortOptions: ReadonlyArray<{ value: IssueSort; label: string }> = [
  { value: "updated_desc", label: "更新日（新しい順）" },
  { value: "created_desc", label: "作成日（新しい順）" },
  { value: "title_asc", label: "タイトル（昇順）" },
  { value: "priority_desc", label: "優先度（Urgent順）" },
  { value: "due_asc", label: "期限（近い順）" },
];

const priorityRank: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  no_priority: 4,
};

export function filterCompletedIssues(
  issues: readonly Issue[],
  workflowStates: readonly WorkflowState[],
  showCompleted: boolean,
): Issue[] {
  if (showCompleted) return [...issues];
  const completedStateIds = new Set(
    workflowStates.filter((state) => state.category === "completed").map((state) => state.id),
  );
  return issues.filter((issue) => !completedStateIds.has(issue.statusId));
}

function tieBreak(left: Issue, right: Issue): number {
  return (
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.identifier.localeCompare(right.identifier, "ja")
  );
}

function compareDue(left: Issue, right: Issue): number {
  if (left.dueAt === null && right.dueAt !== null) return 1;
  if (left.dueAt !== null && right.dueAt === null) return -1;
  if (left.dueAt !== null && right.dueAt !== null && left.dueAt !== right.dueAt)
    return left.dueAt - right.dueAt;
  return tieBreak(left, right);
}

export function sortIssues(issues: readonly Issue[], sort: IssueSort): Issue[] {
  return [...issues].sort((left, right) => {
    if (sort === "created_desc") return right.createdAt - left.createdAt || tieBreak(left, right);
    if (sort === "title_asc")
      return left.title.localeCompare(right.title, "ja") || tieBreak(left, right);
    if (sort === "priority_desc")
      return priorityRank[left.priority] - priorityRank[right.priority] || tieBreak(left, right);
    if (sort === "due_asc") return compareDue(left, right);
    return tieBreak(left, right);
  });
}
