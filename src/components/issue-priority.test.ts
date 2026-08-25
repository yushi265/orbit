import { describe, expect, it } from "vitest";
import { priorityFromSelection } from "./issue-priority";

describe("Issue priority selection", () => {
  it("[同値分割] 許可されたPriorityを返す", () => {
    expect(priorityFromSelection("high")).toBe("high");
  });

  it("[同値分割] 不正なPriorityはNo priorityへ戻す", () => {
    expect(priorityFromSelection("invalid")).toBe("no_priority");
  });
});
