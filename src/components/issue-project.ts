export const NO_PROJECT_OPTION = "__none__";

export function projectIdFromSelection(value: string): string | null {
  return value && value !== NO_PROJECT_OPTION ? value : null;
}

/** IssueのProject選択肢。アーカイブ済みは外し、今設定されているProjectだけはアーカイブ済みでも残す。 */
export function selectableProjects<T extends { id: string; archivedAt: number | null }>(
  projects: ReadonlyArray<T>,
  currentProjectId?: string | null,
): Array<{ project: T; archived: boolean }> {
  return projects
    .filter((project) => !project.archivedAt || project.id === currentProjectId)
    .map((project) => ({ project, archived: Boolean(project.archivedAt) }));
}
