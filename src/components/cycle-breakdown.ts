import { priorityValues, type Priority } from "../shared/contracts";

export interface CycleBreakdownIssue {
  statusId: string;
  priority: Priority;
  projectId: string | null;
}

export interface CycleBreakdownStatus {
  id: string;
  label: string;
  count: number;
}

export interface CycleBreakdownPriority {
  value: Priority;
  count: number;
}

export interface CycleBreakdownProject {
  id: string | null;
  label: string;
  count: number;
}

export interface CycleBreakdown {
  statuses: CycleBreakdownStatus[];
  priorities: CycleBreakdownPriority[];
  projects: CycleBreakdownProject[];
}

export function calculateCycleBreakdown(
  issues: readonly CycleBreakdownIssue[],
  states: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
): CycleBreakdown {
  const statusCounts = new Map<string, number>();
  const priorityCounts = new Map<Priority, number>(priorityValues.map((priority) => [priority, 0]));
  const projectCounts = new Map<string, number>();
  const projectIds = new Set(projects.map((project) => project.id));
  let unassignedCount = 0;

  for (const issue of issues) {
    statusCounts.set(issue.statusId, (statusCounts.get(issue.statusId) ?? 0) + 1);
    priorityCounts.set(issue.priority, (priorityCounts.get(issue.priority) ?? 0) + 1);
    if (issue.projectId && projectIds.has(issue.projectId))
      projectCounts.set(issue.projectId, (projectCounts.get(issue.projectId) ?? 0) + 1);
    else unassignedCount += 1;
  }

  return {
    statuses: states.map((state) => ({
      id: state.id,
      label: state.name,
      count: statusCounts.get(state.id) ?? 0,
    })),
    priorities: priorityValues.map((value) => ({
      value,
      count: priorityCounts.get(value) ?? 0,
    })),
    projects: [
      ...projects
        .filter((project) => (projectCounts.get(project.id) ?? 0) > 0)
        .map((project) => ({
          id: project.id,
          label: project.name,
          count: projectCounts.get(project.id)!,
        })),
      ...(unassignedCount > 0 ? [{ id: null, label: "Projectなし", count: unassignedCount }] : []),
    ],
  };
}
