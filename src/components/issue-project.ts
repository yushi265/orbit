export const NO_PROJECT_OPTION = "__none__";

export function projectIdFromSelection(value: string): string | null {
  return value && value !== NO_PROJECT_OPTION ? value : null;
}
