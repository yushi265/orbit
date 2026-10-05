export { filterProjectIssues } from "./issue-list";

/** 表示中の並びで 1 つ動かすときの `beforeProjectId`。動けない（端・対象なし）は null。 */
export function beforeProjectIdForMove(
  ordered: ReadonlyArray<{ id: string }>,
  projectId: string,
  direction: "up" | "down",
): { beforeProjectId: string | null } | null {
  const index = ordered.findIndex((project) => project.id === projectId);
  if (index < 0) return null;
  if (direction === "up") {
    return index === 0 ? null : { beforeProjectId: ordered[index - 1].id };
  }
  if (index === ordered.length - 1) return null;
  return { beforeProjectId: ordered[index + 2]?.id ?? null };
}
