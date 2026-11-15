import { Link } from "@tanstack/react-router";
import type {
  IssueViewModel,
  ProjectStatusViewModel,
  ProjectViewModel,
  WorkflowStateViewModel,
} from "../shared/view-models";
import { calculateCycleMetrics } from "../shared/cycle-workspace";
import { formatDateOnly } from "./ui/date-format";
import { ALL_PROJECTS_TAB, type ProjectTab } from "./project-tabs";

export function ProjectTabBar({
  tabs,
  selectedId,
  totalOpenCount,
  onSelect,
}: {
  tabs: ProjectTab[];
  selectedId: string;
  totalOpenCount: number;
  onSelect: (projectId: string) => void;
}) {
  const items = [
    ...tabs,
    { id: ALL_PROJECTS_TAB, name: "すべて", color: "", openCount: totalOpenCount },
  ];
  return (
    <div className="project-tabs" role="tablist" aria-label="Project">
      {items.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="project-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const index = items.findIndex((item) => item.id === tab.id);
              const next =
                items[
                  (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length
                ];
              onSelect(next.id);
              requestAnimationFrame(() =>
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                  ?.focus(),
              );
            }}
          >
            {tab.color && (
              <span className="project-tab-dot" style={{ background: tab.color }} aria-hidden />
            )}
            <span className="project-tab-name">{tab.name}</span>
            <span className="project-tab-count" aria-label={`未完了${tab.openCount}件`}>
              {tab.openCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ProjectTabHeader({
  project,
  projectStatuses,
  issues,
  workflowStates,
}: {
  project: ProjectViewModel;
  projectStatuses: ProjectStatusViewModel[];
  issues: IssueViewModel[];
  workflowStates: WorkflowStateViewModel[];
}) {
  const projectIssues = issues.filter(
    (issue) => issue.projectId === project.id && !issue.archivedAt && !issue.deletedAt,
  );
  const metrics = calculateCycleMetrics(projectIssues, workflowStates);
  const status = projectStatuses.find((item) => item.id === project.statusId);
  return (
    <section className="project-tab-header" aria-label={`${project.name}の概要`}>
      <strong className="project-tab-header-name">{project.name}</strong>
      <span className="project-tab-header-meta">
        <span className="status-pill">{status?.name ?? "Status"}</span>
        <span>期限 {formatDateOnly(project.targetAt)}</span>
        <span className="project-tab-progress" aria-hidden>
          <span style={{ width: `${metrics.progressPercent}%` }} />
        </span>
        <span>
          {metrics.progressPercent}%（{metrics.completed}/{metrics.total}）
        </span>
      </span>
      <Link
        className="project-tab-detail-link"
        to="/projects/$projectId"
        params={{ projectId: project.id }}
      >
        Projectの詳細 →
      </Link>
    </section>
  );
}
