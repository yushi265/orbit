import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("Orbit theme", () => {
  it("[代表値] light / darkをそのまま解決する", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("[デシジョンテーブル] systemはOS設定へ解決する", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
