import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  IssueViewModel,
  ProjectStatusViewModel,
  ProjectViewModel,
  WorkflowStateViewModel,
} from "../shared/view-models";
import { calculateCycleMetrics } from "../shared/cycle-workspace";
import { formatDateOnly } from "./ui/date-format";
import { ALL_PROJECTS_TAB, PROJECT_HEADER_OPEN_STORAGE_KEY, type ProjectTab } from "./project-tabs";

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
  // 選択中タブの下線は1本の線を動かして、タブ間をスライドさせる。測れるまでは各タブの下線を使う。
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected || selected.offsetWidth === 0) return setIndicator(null);
    setIndicator({ left: selected.offsetLeft, width: selected.offsetWidth });
  }, [selectedId, tabs]);
  return (
    <div
      ref={listRef}
      className={indicator ? "project-tabs has-indicator" : "project-tabs"}
      role="tablist"
      aria-label="Project"
    >
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
      {indicator && (
        <span
          className="project-tab-indicator"
          aria-hidden
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
      )}
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
  // 一覧を広く見せるため、既定は1行に畳む。開閉は端末ごとに覚える。
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(PROJECT_HEADER_OPEN_STORAGE_KEY) === "1");
    } catch {
      // 覚えていなければ畳んだまま。
    }
  }, []);
  function toggle(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(PROJECT_HEADER_OPEN_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // 開閉状態を覚えられなくても表示は切り替える。
    }
  }
  return (
    <details
      className="project-tab-header"
      aria-label={`${project.name}の概要`}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) toggle(next);
      }}
    >
      <summary className="project-tab-header-summary">
        <span className="project-tab-header-chevron" aria-hidden>
          ›
        </span>
        <strong className="project-tab-header-name">{project.name}</strong>
        <span className="project-tab-progress" aria-hidden>
          <span style={{ width: `${metrics.progressPercent}%` }} />
        </span>
        <span className="project-tab-header-percent">
          {metrics.progressPercent}%（{metrics.completed}/{metrics.total}）
        </span>
      </summary>
      <div className="project-tab-header-body">
        <span className="status-pill">{status?.name ?? "Status"}</span>
        <span>期限 {formatDateOnly(project.targetAt)}</span>
        <Link
          className="project-tab-detail-link"
          to="/projects/$projectId"
          params={{ projectId: project.id }}
        >
          Projectの詳細 →
        </Link>
      </div>
    </details>
  );
}
