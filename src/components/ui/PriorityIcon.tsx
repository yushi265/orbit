import type { IssueViewModel as Issue } from "../../shared/view-models";
import { priorityIconFor } from "../issue-priority";

export function PriorityIcon({ priority }: { priority: Issue["priority"] }) {
  const icon = priorityIconFor(priority);
  return (
    <span
      className={`priority-icon ${icon.name}`}
      role="img"
      aria-label={icon.label}
      title={icon.label}
    >
      <svg
        aria-hidden="true"
        className="priority-glyph"
        viewBox="0 0 16 16"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon.paths.map((path) => (
          <path key={path.d} d={path.d} strokeDasharray={path.dash} />
        ))}
      </svg>
    </span>
  );
}
