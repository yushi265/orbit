import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priorityFromSelection, priorityIconFor } from "./issue-priority";

describe("Issue priority selection", () => {
  it("[同値分割] 許可されたPriorityを返す", () => {
    expect(priorityFromSelection("high")).toBe("high");
  });

  it("[同値分割] 不正なPriorityはNo priorityへ戻す", () => {
    expect(priorityFromSelection("invalid")).toBe("no_priority");
  });

  it("[同値分割] 5つのPriorityへ固有のアイコン名とaccessible labelを割り当てる", () => {
    expect(priorityIconFor("no_priority")).toMatchObject({ name: "none", label: "No priority" });
    expect(priorityIconFor("low")).toMatchObject({ name: "low", label: "Low" });
    expect(priorityIconFor("medium")).toMatchObject({ name: "medium", label: "Medium" });
    expect(priorityIconFor("high")).toMatchObject({ name: "high", label: "High" });
    expect(priorityIconFor("urgent")).toMatchObject({ name: "urgent", label: "Urgent" });
  });

  it("[デシジョンテーブル] 5つのPriorityのシェブロンpathが契約どおり", () => {
    expect(priorityIconFor("urgent").paths).toEqual([
      { d: "M4 8.5 8 4.5l4 4" },
      { d: "M4 12.5 8 8.5l4 4" },
    ]);
    expect(priorityIconFor("high").paths).toEqual([{ d: "M4 10 8 6l4 4" }]);
    expect(priorityIconFor("medium").paths).toEqual([{ d: "M4 6.5h8" }, { d: "M4 9.5h8" }]);
    expect(priorityIconFor("low").paths).toEqual([{ d: "M4 6l4 4 4-4" }]);
    expect(priorityIconFor("no_priority").paths).toEqual([{ d: "M3.5 8h9", dash: "1 3" }]);
  });

  it("[代表値] 旧アイコンのCSSが残っていない", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).not.toContain(".priority-bars");
    expect(css).not.toContain(".priority-urgent-mark");
    expect(css).not.toContain(".priority-none-mark");
  });
});
