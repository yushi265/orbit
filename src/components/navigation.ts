export function projectDetailPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function issueDetailPath(issueId: string): string {
  return `/issues/${encodeURIComponent(issueId)}`;
}
