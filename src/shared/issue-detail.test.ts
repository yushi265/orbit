import { describe, expect, it } from "vitest";
import {
  activityViewSchema,
  issueDetailResponseSchema,
  noteMutationSchema,
  relationMutationSchema,
  relationTypeSchema,
} from "./contracts";

describe("Issue detail shared contract", () => {
  it("[境界値] note bodyは1..10000 Unicode code pointsを受け入れる", () => {
    const base = { idempotencyKey: "note-key", body: "a" };
    expect(noteMutationSchema.safeParse({ ...base, body: "" }).success).toBe(false);
    expect(noteMutationSchema.safeParse(base).success).toBe(true);
    expect(noteMutationSchema.safeParse({ ...base, version: 1 }).success).toBe(false);
    expect(noteMutationSchema.safeParse({ ...base, body: "あ".repeat(10_000) }).success).toBe(true);
    expect(noteMutationSchema.safeParse({ ...base, body: "あ".repeat(10_001) }).success).toBe(
      false,
    );
  });

  it("[同値分割] Relation typeは4つのwire valueだけを受け入れる", () => {
    for (const type of ["blocking", "blocked_by", "related", "duplicate"]) {
      expect(relationTypeSchema.safeParse(type).success).toBe(true);
      expect(
        relationMutationSchema.safeParse({
          idempotencyKey: "relation-key",
          targetIssueId: "issue-2",
          type,
        }).success,
      ).toBe(true);
    }
    expect(relationTypeSchema.safeParse("blocks").success).toBe(false);
    expect(
      relationMutationSchema.safeParse({
        idempotencyKey: "relation-key",
        targetIssueId: "",
        type: "related",
      }).success,
    ).toBe(false);
    expect(
      relationMutationSchema.safeParse({
        idempotencyKey: "relation-key",
        targetIssueId: "issue-2",
        type: "related",
        version: 1,
      }).success,
    ).toBe(false);
  });

  it("[契約] note / relation schemaは未知の内部値を公開入力へ許可しない", () => {
    expect(
      noteMutationSchema.safeParse({
        idempotencyKey: "note-key",
        body: "memo",
        lock_token: "secret",
      }).success,
    ).toBe(false);
    expect(
      relationMutationSchema.safeParse({
        idempotencyKey: "relation-key",
        targetIssueId: "issue-2",
        type: "related",
        userId: "other",
      }).success,
    ).toBe(false);
  });

  it("[セキュリティ境界] Activityの公開型はmutation keyを含めない", () => {
    const base = {
      id: "activity-1",
      userId: "owner",
      entityType: "issue",
      entityId: "issue-1",
      action: "updated",
      actorType: "user",
      before: null,
      after: null,
      createdAt: 1,
    };
    expect(activityViewSchema.safeParse(base).success).toBe(true);
    expect(activityViewSchema.safeParse({ ...base, mutationKey: "secret" }).success).toBe(false);
  });

  it("[契約] Detail responseは内部Tokenを含むpayloadを拒否する", () => {
    const response = {
      issue: {
        id: "issue-1",
        userId: "owner",
        number: 1,
        identifier: "TASK-1",
        title: "Issue",
        description: "",
        statusId: "state-1",
        priority: "no_priority",
        estimate: null,
        dueAt: null,
        projectId: null,
        cycleId: null,
        parentId: null,
        labelIds: [],
        position: 0,
        version: 1,
        archivedAt: null,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
      notes: [
        {
          id: "note-1",
          userId: "owner",
          issueId: "issue-1",
          body: "memo",
          createdAt: 1,
          editedAt: null,
          deletedAt: null,
        },
      ],
      relations: [
        {
          id: "relation-1",
          userId: "owner",
          sourceIssueId: "issue-1",
          targetIssueId: "issue-2",
          type: "related",
          createdAt: 1,
          target: {
            id: "issue-2",
            identifier: "TASK-2",
            title: "Related",
            statusId: "state-1",
          },
        },
      ],
      activity: [
        {
          id: "activity-1",
          userId: "owner",
          entityType: "issue",
          entityId: "issue-1",
          action: "created",
          actorType: "user",
          before: null,
          after: { title: "Issue" },
          createdAt: 1,
        },
      ],
    };
    expect(issueDetailResponseSchema.safeParse(response).success).toBe(true);
    expect(
      issueDetailResponseSchema.safeParse({
        ...response,
        activity: [{ ...response.activity[0], after: { mutationKey: "secret" } }],
      }).success,
    ).toBe(false);
    expect(
      issueDetailResponseSchema.safeParse({
        ...response,
        issue: { ...response.issue, lock_token: "secret" },
      }).success,
    ).toBe(false);
    for (const key of ["email", "cookie", "unknown_key"]) {
      expect(
        issueDetailResponseSchema.safeParse({
          ...response,
          issue: { ...response.issue, [key]: "secret" },
        }).success,
      ).toBe(false);
    }
  });
});
