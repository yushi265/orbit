import type {
  IssueViewModel,
  ProjectStatusViewModel,
  ProjectViewModel,
  WorkflowStateViewModel,
} from "../shared/view-models";

export type ProjectTab = { id: string; name: string; color: string; openCount: number };

// 「すべて」タブを表す値。URL では project パラメータなしで表す。
export const ALL_PROJECTS_TAB = "all";

const closedProjectCategories = new Set<ProjectStatusViewModel["category"]>([
  "completed",
  "canceled",
]);
const closedIssueCategories = new Set<WorkflowStateViewModel["category"]>([
  "completed",
  "canceled",
]);

function openIssues(issues: IssueViewModel[], workflowStates: WorkflowStateViewModel[]) {
  const issueCategory = new Map(workflowStates.map((state) => [state.id, state.category]));
  return issues.filter((issue) => {
    if (issue.archivedAt || issue.deletedAt) return false;
    const category = issueCategory.get(issue.statusId);
    return !category || !closedIssueCategories.has(category);
  });
}

// 「すべて」タブの件数。Projectなしも含める。
export function countOpenIssues(
  issues: IssueViewModel[],
  workflowStates: WorkflowStateViewModel[],
): number {
  return openIssues(issues, workflowStates).length;
}

// Statusが見つからないProject・Issueは閉じたものとして隠さず、開いている側に数える（安全側）。
export function selectProjectTabs({
  projects,
  projectStatuses,
  issues,
  workflowStates,
  selectedProjectId,
}: {
  projects: ProjectViewModel[];
  projectStatuses: ProjectStatusViewModel[];
  issues: IssueViewModel[];
  workflowStates: WorkflowStateViewModel[];
  selectedProjectId: string | null;
}): ProjectTab[] {
  const projectCategory = new Map(projectStatuses.map((status) => [status.id, status.category]));
  const openCounts = new Map<string, number>();
  for (const issue of openIssues(issues, workflowStates)) {
    if (issue.projectId)
      openCounts.set(issue.projectId, (openCounts.get(issue.projectId) ?? 0) + 1);
  }
  return projects
    .filter((project) => {
      if (project.archivedAt || project.deletedAt) return false;
      if (project.id === selectedProjectId) return true;
      const category = projectCategory.get(project.statusId);
      return !category || !closedProjectCategories.has(category);
    })
    .map((project) => ({
      id: project.id,
      name: project.name,
      color: project.color,
      openCount: openCounts.get(project.id) ?? 0,
    }));
}

// サイドバーの Issues から入るときのタブ。前回のタブが今も出ていればそれ、無ければ先頭のProject。
export function issuesEntryProjectId(tabs: ProjectTab[], remembered: string | null): string {
  if (remembered === ALL_PROJECTS_TAB) return ALL_PROJECTS_TAB;
  if (remembered && tabs.some((tab) => tab.id === remembered)) return remembered;
  return tabs[0]?.id ?? ALL_PROJECTS_TAB;
}

export const LAST_ISSUES_PROJECT_STORAGE_KEY = "orbit.issues.lastProject";

// IssuesのProjectヘッダー（概要カード）を開いたままにするか。
export const PROJECT_HEADER_OPEN_STORAGE_KEY = "orbit.issues.projectHeaderOpen";
