import { describe, expect, it } from "vitest";
import {
  issueQuerySchema,
  projectMetadataMutationSchema,
  savedViewMutationSchema,
  savedViewUpdateSchema,
} from "./contracts";

const query = {
  mode: "list" as const,
  filter: {},
  showEmptyGroups: false,
  order: "manual" as const,
  layout: { priority: true },
  limit: 100,
};

describe("Project / Saved View shared contract", () => {
  it("[境界値] Project name / descriptionのUnicode長を検証する", () => {
    const base = { idempotencyKey: "project-meta-1" };
    expect(projectMetadataMutationSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(projectMetadataMutationSchema.safeParse({ ...base, name: "a" }).success).toBe(true);
    expect(
      projectMetadataMutationSchema.safeParse({ ...base, name: "😀".repeat(100) }).success,
    ).toBe(true);
    expect(
      projectMetadataMutationSchema.safeParse({ ...base, name: "😀".repeat(101) }).success,
    ).toBe(false);
    expect(
      projectMetadataMutationSchema.safeParse({ ...base, description: "あ".repeat(2_000) }).success,
    ).toBe(true);
    expect(projectMetadataMutationSchema.safeParse({ ...base, description: "" }).success).toBe(
      true,
    );
    expect(projectMetadataMutationSchema.safeParse({ ...base, version: 1 }).success).toBe(false);
    expect(
      projectMetadataMutationSchema.safeParse({ ...base, description: "あ".repeat(2_001) }).success,
    ).toBe(false);
  });

  it("[契約] Saved Viewは既存IssueQueryとstrict mutationを使う", () => {
    expect(issueQuerySchema.safeParse(query).success).toBe(true);
    expect(
      savedViewMutationSchema.safeParse({
        idempotencyKey: "view-1",
        name: "My view",
        query,
        layout: { priority: true },
      }).success,
    ).toBe(true);
    expect(
      savedViewMutationSchema.safeParse({
        idempotencyKey: "view-1",
        name: "My view",
        query,
        secret: "nope",
      }).success,
    ).toBe(false);
    expect(
      savedViewMutationSchema.safeParse({
        idempotencyKey: "view-query-unknown",
        name: "My view",
        query: { ...query, unknown: true },
      }).success,
    ).toBe(false);
    expect(
      savedViewMutationSchema.safeParse({
        idempotencyKey: "view-boundary",
        name: "a".repeat(80),
        query,
      }).success,
    ).toBe(true);
    expect(
      savedViewMutationSchema.safeParse({ idempotencyKey: "view-boundary", name: "", query })
        .success,
    ).toBe(false);
    expect(
      savedViewMutationSchema.safeParse({
        idempotencyKey: "view-boundary-astral",
        name: "😀",
        query,
      }).success,
    ).toBe(true);
    expect(
      savedViewMutationSchema.safeParse({
        idempotencyKey: "view-boundary-long",
        name: "a".repeat(81),
        query,
      }).success,
    ).toBe(false);
    expect(
      savedViewUpdateSchema.safeParse({
        idempotencyKey: "view-update-unknown",
        secret: true,
      }).success,
    ).toBe(false);
  });
});
