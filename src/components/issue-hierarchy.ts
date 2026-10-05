import { calculateCycleMetrics } from "../shared/cycle-workspace";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";

export const COLLAPSED_PARENTS_STORAGE_KEY = "orbit.issues.collapsedParents";

type CollapsedStorage = Pick<Storage, "getItem" | "setItem">;

export interface IssueHierarchyRow {
  issue: Issue;
  depth: number;
  parentKey: string | null;
  hasVisibleChildren: boolean;
  collapsed: boolean;
  childProgress: { completed: number; total: number } | null;
  parentHint: { identifier: string; title: string } | null;
}

export function buildIssueHierarchyRows({
  issues,
  allIssues,
  workflowStates,
  collapsed,
}: {
  issues: readonly Issue[];
  allIssues: readonly Issue[];
  workflowStates: readonly WorkflowState[];
  collapsed: ReadonlySet<string>;
}): IssueHierarchyRow[] {
  const visibleIds = new Set(issues.map((issue) => issue.id));
  const allById = new Map(allIssues.map((issue) => [issue.id, issue]));
  const visibleChildren = new Map<string, Issue[]>();
  const topLevel: Issue[] = [];
  for (const issue of issues) {
    if (issue.parentId && visibleIds.has(issue.parentId)) {
      const siblings = visibleChildren.get(issue.parentId) ?? [];
      siblings.push(issue);
      visibleChildren.set(issue.parentId, siblings);
    } else {
      topLevel.push(issue);
    }
  }
  const allChildren = new Map<string, Issue[]>();
  for (const issue of allIssues) {
    if (!issue.parentId) continue;
    const siblings = allChildren.get(issue.parentId) ?? [];
    siblings.push(issue);
    allChildren.set(issue.parentId, siblings);
  }

  const rows: IssueHierarchyRow[] = [];
  const visited = new Set<string>();
  function visit(issue: Issue, depth: number, parentKey: string | null) {
    if (visited.has(issue.id)) return;
    visited.add(issue.id);
    const children = visibleChildren.get(issue.id) ?? [];
    const isCollapsed = collapsed.has(issue.id);
    const directChildren = allChildren.get(issue.id) ?? [];
    const parent = issue.parentId ? allById.get(issue.parentId) : undefined;
    rows.push({
      issue,
      depth,
      parentKey,
      hasVisibleChildren: children.length > 0,
      collapsed: isCollapsed,
      childProgress: directChildren.length
        ? (({ completed, total }) => ({ completed, total }))(
            calculateCycleMetrics(directChildren, workflowStates),
          )
        : null,
      parentHint:
        parent && !visibleIds.has(parent.id)
          ? { identifier: parent.identifier, title: parent.title }
          : null,
    });
    for (const child of children) {
      if (isCollapsed) hide(child);
      else visit(child, depth + 1, issue.id);
    }
  }
  function hide(issue: Issue) {
    if (visited.has(issue.id)) return;
    visited.add(issue.id);
    for (const child of visibleChildren.get(issue.id) ?? []) hide(child);
  }
  for (const issue of topLevel) visit(issue, 0, null);
  // Cycles leave issues unreachable from any top-level row; surface them at the top level.
  for (const issue of issues) {
    if (visited.has(issue.id)) continue;
    visit(issue, 0, null);
  }
  return rows;
}

export function readCollapsedParents(storage: CollapsedStorage | undefined): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(COLLAPSED_PARENTS_STORAGE_KEY) ?? "null");
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string"))
      return new Set();
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function writeCollapsedParents(
  storage: CollapsedStorage | undefined,
  ids: Iterable<string>,
): void {
  try {
    storage?.setItem(COLLAPSED_PARENTS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage failures; the in-memory state still applies.
  }
}
