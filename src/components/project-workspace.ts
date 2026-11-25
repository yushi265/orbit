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

/** Projects一覧用。順を保ってアーカイブ済みとそれ以外に分ける。 */
export function splitArchivedProjects<T extends { archivedAt: number | null }>(
  projects: ReadonlyArray<T>,
): { active: T[]; archived: T[] } {
  return {
    active: projects.filter((project) => !project.archivedAt),
    archived: projects.filter((project) => Boolean(project.archivedAt)),
  };
}
