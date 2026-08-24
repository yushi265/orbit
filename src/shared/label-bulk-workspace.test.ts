import { describe, expect, it } from "vitest";
import { bulkIssueMutationSchema } from "./contracts/bulk";
import { labelMutationSchema, labelUpdateSchema } from "./contracts/labels";

const queryPatch = { statusId: "status_1" };

describe("Label / Issue Bulk shared contract", () => {
  it("[境界値] Label nameはUnicode 1..50、colorはhexを検証する", () => {
    expect(
      labelMutationSchema.safeParse({
        idempotencyKey: "label-boundary",
        name: "😀",
        color: "#000000",
      }).success,
    ).toBe(true);
    expect(
      labelMutationSchema.safeParse({ idempotencyKey: "label-empty", name: "", color: "#000000" })
        .success,
    ).toBe(false);
    expect(
      labelMutationSchema.safeParse({
        idempotencyKey: "key50",
        name: "😀".repeat(50),
        color: "#FFFFFF",
      }).success,
    ).toBe(true);
    expect(
      labelMutationSchema.safeParse({
        idempotencyKey: "key51",
        name: "😀".repeat(51),
        color: "#FFFFFF",
      }).success,
    ).toBe(false);
    expect(
      labelMutationSchema.safeParse({
        idempotencyKey: "label-color-invalid",
        name: "Bug",
        color: "red",
      }).success,
    ).toBe(false);
    expect(labelUpdateSchema.safeParse({ idempotencyKey: "label-update-empty" }).success).toBe(
      false,
    );
    expect(
      labelUpdateSchema.safeParse({ idempotencyKey: "label-update-unknown", secret: true }).success,
    ).toBe(false);
  });

  it("[境界値] Bulkは1..100件・単一patch・重複ID正規化を検証する", () => {
    const parsed = bulkIssueMutationSchema.safeParse({
      idempotencyKey: "bulk-boundary",
      issueIds: ["issue_1", "issue_1", "issue_2"],
      patch: queryPatch,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.issueIds).toEqual(["issue_1", "issue_2"]);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-empty",
        issueIds: [],
        patch: queryPatch,
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-one-valid",
        issueIds: ["issue_1"],
        patch: queryPatch,
      }).success,
    ).toBe(true);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-hundred-valid",
        issueIds: Array.from({ length: 100 }, (_, index) => `issue_${index}`),
        patch: queryPatch,
      }).success,
    ).toBe(true);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-one",
        issueIds: ["issue_1"],
        patch: { labelIds: [] },
      }).success,
    ).toBe(true);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-label-too-many",
        issueIds: ["issue_1"],
        patch: { labelIds: ["label_1", "label_2"] },
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: null,
        issueIds: ["issue_1"],
        patch: queryPatch,
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: 123,
        issueIds: ["issue_1"],
        patch: queryPatch,
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({ issueIds: ["issue_1"], patch: queryPatch }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-too-many",
        issueIds: Array.from({ length: 101 }, (_, index) => `issue_${index}`),
        patch: queryPatch,
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-empty-patch",
        issueIds: ["issue_1"],
        patch: {},
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-two-fields",
        issueIds: ["issue_1"],
        patch: { statusId: "status_1", priority: "high" },
      }).success,
    ).toBe(false);
    expect(
      bulkIssueMutationSchema.safeParse({
        idempotencyKey: "bulk-unknown",
        issueIds: ["issue_1"],
        patch: { secret: true },
      }).success,
    ).toBe(false);
  });
});
