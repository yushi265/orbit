import { describe, expect, it } from "vitest";
import { inverseIssuePatch } from "./issue-undo";

describe("Issue undo patch", () => {
  it("builds an inverse patch from the original values", () => {
    const issue = { statusId: "todo", priority: "high", title: "Original" };
    const patch = { statusId: "done", priority: "urgent" };

    expect(inverseIssuePatch(issue, patch)).toEqual({ statusId: "todo", priority: "high" });
    expect(patch).toEqual({ statusId: "done", priority: "urgent" });
  });
});
