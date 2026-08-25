import type { Priority } from "../shared/contracts";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";

export type IssueSort =
  | "manual"
  | "updated_desc"
  | "created_desc"
  | "title_asc"
  | "status_asc"
  | "priority_desc"
  | "due_asc";

export const issueSortOptions: ReadonlyArray<{ value: IssueSort; label: string }> = [
  { value: "manual", label: "手動" },
  { value: "updated_desc", label: "更新日（新しい順）" },
  { value: "created_desc", label: "作成日（新しい順）" },
  { value: "title_asc", label: "タイトル（昇順）" },
  { value: "status_asc", label: "ステータス順" },
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

export function sortIssues(
  issues: readonly Issue[],
  sort: IssueSort,
  workflowStates: readonly Pick<WorkflowState, "id" | "position">[] = [],
): Issue[] {
  const statusRank = new Map(workflowStates.map((state) => [state.id, state.position]));
  return [...issues].sort((left, right) => {
    if (sort === "manual") return left.position - right.position || tieBreak(left, right);
    if (sort === "created_desc") return right.createdAt - left.createdAt || tieBreak(left, right);
    if (sort === "title_asc")
      return left.title.localeCompare(right.title, "ja") || tieBreak(left, right);
    if (sort === "status_asc")
      return (
        (statusRank.get(left.statusId) ?? Number.MAX_SAFE_INTEGER) -
          (statusRank.get(right.statusId) ?? Number.MAX_SAFE_INTEGER) || tieBreak(left, right)
      );
    if (sort === "priority_desc")
      return priorityRank[left.priority] - priorityRank[right.priority] || tieBreak(left, right);
    if (sort === "due_asc") return compareDue(left, right);
    return tieBreak(left, right);
  });
}

export function beforeIssueIdForDrop(
  orderedIssues: readonly Issue[],
  draggedIssueId: string,
  dropTargetIssueId: string,
): string | null {
  if (draggedIssueId === dropTargetIssueId) return null;
  const draggedIndex = orderedIssues.findIndex((issue) => issue.id === draggedIssueId);
  const targetIndex = orderedIssues.findIndex((issue) => issue.id === dropTargetIssueId);
  if (draggedIndex < 0 || targetIndex < 0) return null;
  const remaining = orderedIssues.filter((issue) => issue.id !== draggedIssueId);
  const remainingTargetIndex = remaining.findIndex((issue) => issue.id === dropTargetIssueId);
  if (remainingTargetIndex < 0) return null;
  if (draggedIndex > targetIndex) return dropTargetIssueId;
  return remaining[remainingTargetIndex + 1]?.id ?? null;
}

export function beforeIssueIdForMove(
  orderedIssues: readonly Issue[],
  issueId: string,
  direction: "up" | "down",
): string | null {
  const index = orderedIssues.findIndex((issue) => issue.id === issueId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= orderedIssues.length) return null;
  return beforeIssueIdForDrop(orderedIssues, issueId, orderedIssues[targetIndex].id);
}
