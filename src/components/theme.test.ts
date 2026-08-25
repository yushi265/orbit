import { describe, expect, it } from "vitest";
import { colorThemeOptions, resolveTheme } from "./theme";

describe("Orbit theme", () => {
  it("[代表値] light / darkをそのまま解決する", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("[デシジョンテーブル] systemはOS設定へ解決する", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("[同値分割] 5つのカラーテーマを表示名付きで公開する", () => {
    expect(colorThemeOptions.map((option) => option.value)).toEqual([
      "coral",
      "ocean",
      "violet",
      "forest",
      "amber",
    ]);
    expect(colorThemeOptions.every((option) => option.label.length > 0)).toBe(true);
  });
});
