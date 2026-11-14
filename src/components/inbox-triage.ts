import type { IssueViewModel, WorkflowStateViewModel } from "../shared/view-models";

// FEAT-inbox-triage: Inboxは「Projectなし かつ 完了・キャンセル以外」のIssueを振り分け待ちとして集める。
// Statusが見つからないIssueは完了扱いで隠さず、振り分け待ちに含める（安全側）。
const closedCategories = new Set<WorkflowStateViewModel["category"]>(["completed", "canceled"]);

export function selectInboxIssues(
  issues: IssueViewModel[],
  workflowStates: WorkflowStateViewModel[],
): IssueViewModel[] {
  const categoryById = new Map(workflowStates.map((state) => [state.id, state.category]));
  return issues
    .filter((issue) => {
      if (issue.projectId !== null) return false;
      const category = categoryById.get(issue.statusId);
      return !category || !closedCategories.has(category);
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}
