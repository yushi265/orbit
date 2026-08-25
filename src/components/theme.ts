import type { ColorTheme, Theme } from "../shared/contracts";

export type ResolvedTheme = Exclude<Theme, "system">;

export const colorThemeOptions: ReadonlyArray<{
  value: ColorTheme;
  label: string;
  accent: string;
}> = [
  { value: "coral", label: "Coral", accent: "#ff725e" },
  { value: "ocean", label: "Ocean", accent: "#3b82f6" },
  { value: "violet", label: "Violet", accent: "#8b5cf6" },
  { value: "forest", label: "Forest", accent: "#2f9e72" },
  { value: "amber", label: "Amber", accent: "#d97706" },
];

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}
