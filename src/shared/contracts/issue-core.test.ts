import { describe, expect, it } from "vitest";
import {
  issueFilterSchema,
  issueListScopeSchema,
  recentIssueViewMutationSchema,
  recentSearchMutationSchema,
  normalizeIssueFilter,
} from "./index";

describe("Phase 2 Issue core shared contract", () => {
  it("[同値分割 + 境界値] IssueFilterはtextと既存属性をcanonicalに正規化する", () => {
    const parsed = issueFilterSchema.parse({
      text: "  auth  ",
      priorities: ["urgent", "high", "urgent"],
      projectIds: ["project-2", "project-1"],
    });

    expect(normalizeIssueFilter(parsed)).toEqual({
      text: "auth",
      priorities: ["high", "urgent"],
      projectIds: ["project-1", "project-2"],
    });
    expect(issueFilterSchema.safeParse({ text: "a".repeat(255) }).success).toBe(true);
    expect(issueFilterSchema.safeParse({ text: "a".repeat(256) }).success).toBe(false);
  });

  it("[デシジョンテーブル] Issue list scopeはactive / archived / trashだけを受理する", () => {
    expect(issueListScopeSchema.parse("active")).toBe("active");
    expect(issueListScopeSchema.parse("archived")).toBe("archived");
    expect(issueListScopeSchema.parse("trash")).toBe("trash");
    expect(issueListScopeSchema.safeParse("all").success).toBe(false);
  });

  it("[代表値] Recent mutationはIssue viewとcanonical searchをstrictに検証する", () => {
    expect(
      recentIssueViewMutationSchema.parse({
        idempotencyKey: "recent-view-1",
        issueId: "issue-1",
      }),
    ).toEqual({ idempotencyKey: "recent-view-1", issueId: "issue-1" });
    expect(
      recentSearchMutationSchema.parse({
        idempotencyKey: "recent-search-1",
        query: { text: "bug", filter: { priorities: ["high"] } },
      }),
    ).toMatchObject({ query: { text: "bug", filter: { priorities: ["high"] } } });
    expect(
      recentSearchMutationSchema.safeParse({
        idempotencyKey: "recent-search-2",
        query: { text: "", filter: {} },
      }).success,
    ).toBe(false);
  });
});
