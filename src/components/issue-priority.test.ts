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
    expect(priorityIconFor("no_priority")).toEqual({ name: "none", label: "No priority" });
    expect(priorityIconFor("low")).toEqual({ name: "low", label: "Low" });
    expect(priorityIconFor("medium")).toEqual({ name: "medium", label: "Medium" });
    expect(priorityIconFor("high")).toEqual({ name: "high", label: "High" });
    expect(priorityIconFor("urgent")).toEqual({ name: "urgent", label: "Urgent" });
  });
});
