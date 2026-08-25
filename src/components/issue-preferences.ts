export const SHOW_COMPLETED_STORAGE_KEY = "orbit.issues.showCompleted";

export function parseShowCompletedPreference(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
