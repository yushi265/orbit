import { describe, expect, it } from "vitest";
import type { ProjectViewModel } from "../view-models";
import { projectReorderMutationSchema } from "./projects";

const valid = { idempotencyKey: "k1", projectId: "p1", beforeProjectId: "p2" };

describe("Project reorder contract", () => {
  it("[同値分割] beforeProjectIdがID／nullは受理する", () => {
    expect(projectReorderMutationSchema.safeParse(valid).success).toBe(true);
    expect(
      projectReorderMutationSchema.safeParse({ ...valid, beforeProjectId: null }).success,
    ).toBe(true);
  });

  it.each([
    ["idempotencyKeyが空", { ...valid, idempotencyKey: "" }],
    ["projectIdが空", { ...valid, projectId: "" }],
    ["beforeProjectIdが空文字", { ...valid, beforeProjectId: "" }],
    ["beforeProjectIdが未指定", { idempotencyKey: "k1", projectId: "p1" }],
    ["未知の項目position", { ...valid, position: 1 }],
  ])("[同値分割] %sは拒否する", (_name, input) => {
    expect(projectReorderMutationSchema.safeParse(input).success).toBe(false);
  });

  it("[代表値] ProjectViewModelはposition: numberを持ち既存項目も保つ", () => {
    const project: ProjectViewModel = {
      id: "p",
      userId: "u",
      name: "n",
      statusId: "s",
      priority: "medium",
      color: "c",
      icon: "i",
      description: "",
      startAt: null,
      targetAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 2,
      position: 0,
    };
    expect(project.position).toBe(0);
    expect(Object.keys(project)).toContain("name");
  });
});
