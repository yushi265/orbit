import { describe, expect, it } from "vitest";
import { issueDetailPath, projectDetailPath } from "./navigation";

describe("Orbit navigation paths", () => {
  it("[代表値] ProjectとIssueの専用URLを生成する", () => {
    expect(projectDetailPath("project_123")).toBe("/projects/project_123");
    expect(issueDetailPath("issue_456")).toBe("/issues/issue_456");
  });
});
