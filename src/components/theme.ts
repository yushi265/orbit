import type { Theme } from "../shared/contracts";

export type ResolvedTheme = Exclude<Theme, "system">;

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}
