import type { CycleStatus, WorkflowCategory } from "./contracts";

export type CycleTab = "current" | "upcoming" | "past";

export interface CycleMetrics {
  total: number;
  completed: number;
  canceled: number;
  progressPercent: number;
  estimateTotal: number;
}

export interface CycleMetricIssue {
  statusId: string;
  estimate: number | null;
}

export interface CycleMetricState {
  id: string;
  category: WorkflowCategory | string;
}

export function cycleTabForStatus(status: CycleStatus): CycleTab {
  if (status === "active") return "current";
  if (status === "upcoming") return "upcoming";
  return "past";
}

export function calculateCycleMetrics(
  issues: readonly CycleMetricIssue[],
  states: readonly CycleMetricState[],
): CycleMetrics {
  const stateById = new Map(states.map((state) => [state.id, state.category]));
  let completed = 0;
  let canceled = 0;
  let estimateTotal = 0;
  for (const issue of issues) {
    const category = stateById.get(issue.statusId);
    if (category === "completed") completed += 1;
    if (category === "canceled") canceled += 1;
    if (category !== "canceled") estimateTotal += issue.estimate ?? 0;
  }
  const denominator = issues.length - canceled;
  return {
    total: issues.length,
    completed,
    canceled,
    progressPercent: denominator ? Math.round((completed / denominator) * 100) : 0,
    estimateTotal,
  };
}
