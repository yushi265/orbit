import { describe, expect, it } from "vitest";

import {
  cycleStatusSchema,
  estimateSchema,
  localeSchema,
  prioritySchema,
  projectStatusCategorySchema,
  runStatusSchema,
  runStepSchema,
  stepStatusSchema,
  themeSchema,
  workflowCategorySchema,
} from "./contracts/enums";
import { ERROR_STATUS_BY_CODE, errorEnvelopeSchema, errorStatusForCode } from "./contracts/errors";
import {
  createIssueInputSchema,
  issueFilterSchema,
  issueQuerySchema,
  normalizeIssueQuery,
  updateIssueInputSchema,
} from "./contracts/issues";
import { tiptapDocumentSchema } from "./contracts/rich-text";
import {
  continueRunInputSchema,
  continueRunResponseSchema,
  maintenanceRunCreateInputSchema,
  resumeRunInputSchema,
  runErrorSchema,
  runProgressSchema,
  runSummarySchema,
} from "./contracts/background-runs";

describe("共有 enum 契約", () => {
  it("[同値分割] wire value のみを受け入れ、表示名を受け入れない", () => {
    expect(localeSchema.safeParse("ja").success).toBe(true);
    expect(themeSchema.safeParse("system").success).toBe(true);
    expect(prioritySchema.safeParse("urgent").success).toBe(true);
    expect(workflowCategorySchema.safeParse("started").success).toBe(true);
    expect(projectStatusCategorySchema.safeParse("in_progress").success).toBe(true);
    expect(cycleStatusSchema.safeParse("active").success).toBe(true);
    expect(runStatusSchema.safeParse("paused").success).toBe(true);
    expect(runStepSchema.safeParse("cycle_transition").success).toBe(true);
    expect(stepStatusSchema.safeParse("succeeded").success).toBe(true);

    expect(prioritySchema.safeParse("High").success).toBe(false);
    expect(workflowCategorySchema.safeParse("Started").success).toBe(false);
  });

  it("[同値分割] estimate は許可された wire value と null だけを受け入れる", () => {
    for (const value of [null, 1, 2, 3, 5, 8]) {
      expect(estimateSchema.safeParse(value).success).toBe(true);
    }

    for (const value of [0, 4, 13, "3"]) {
      expect(estimateSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("ErrorEnvelope 契約", () => {
  it("[代表値] 全 Error code が指定 status に対応する", () => {
    const expectedStatuses = {
      AUTH_REQUIRED: 401,
      VALIDATION_ERROR: 400,
      RESOURCE_NOT_FOUND: 404,
      ISSUE_VERSION_CONFLICT: 409,
      IDEMPOTENCY_KEY_REUSED: 409,
      OPERATION_IN_PROGRESS: 423,
      RUN_REQUIRES_RESUME: 409,
      BACKGROUND_RUN_REJECTED: 409,
      INTERNAL_ERROR: 500,
    } as const;

    expect(ERROR_STATUS_BY_CODE).toEqual(expectedStatuses);
    for (const [code, status] of Object.entries(expectedStatuses)) {
      expect(errorStatusForCode(code as keyof typeof expectedStatuses)).toBe(status);
    }
  });

  it("[代表値＋契約] requestId と任意 fieldErrors を含む Envelope を decode できる", () => {
    const envelope = {
      error: {
        code: "VALIDATION_ERROR",
        message: "入力内容を確認してください。",
        fieldErrors: { title: ["必須です。"] },
        requestId: "req-123",
      },
    };

    expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(
      errorEnvelopeSchema.safeParse({
        ...envelope,
        error: { ...envelope.error, lock_token: "secret" },
      }).success,
    ).toBe(false);
  });
});

describe("Issue / Filter 契約", () => {
  it("[同値分割＋境界値] title は Unicode code point で 1..255 を受け入れる", () => {
    const inputFor = (length: number) => ({
      idempotencyKey: "opaque-key",
      title: Array.from({ length }, () => "あ").join(""),
    });

    expect(createIssueInputSchema.safeParse(inputFor(0)).success).toBe(false);
    expect(createIssueInputSchema.safeParse(inputFor(1)).success).toBe(true);
    expect(createIssueInputSchema.safeParse(inputFor(255)).success).toBe(true);
    expect(createIssueInputSchema.safeParse(inputFor(256)).success).toBe(false);
  });

  it("[代表値＋契約] Update Issue は version を必須とし、patch の共通メタデータを拒否する", () => {
    expect(
      updateIssueInputSchema.safeParse({
        id: "issue-1",
        idempotencyKey: "opaque-key",
        patch: { title: "更新後" },
      }).success,
    ).toBe(false);

    expect(
      updateIssueInputSchema.safeParse({
        id: "issue-1",
        idempotencyKey: "opaque-key",
        version: 3,
        patch: { title: "更新後" },
      }).success,
    ).toBe(true);

    expect(
      updateIssueInputSchema.safeParse({
        id: "issue-1",
        idempotencyKey: "opaque-key",
        version: 3,
        patch: { version: 4 },
      }).success,
    ).toBe(false);
  });

  it("[代表値＋境界値] Filter は複数条件を検証し、created の逆転した範囲を拒否する", () => {
    expect(
      issueFilterSchema.safeParse({
        priorities: ["high", "urgent"],
        created: { from: 100, to: 200 },
      }).success,
    ).toBe(true);

    expect(
      issueFilterSchema.safeParse({
        priorities: ["High"],
      }).success,
    ).toBe(false);
    expect(
      issueFilterSchema.safeParse({
        created: { from: 200, to: 100 },
      }).success,
    ).toBe(false);
  });

  it("[代表値] 空条件と配列順を canonical な IssueQuery へ正規化する", () => {
    const query = {
      mode: "list" as const,
      filter: {
        statusIds: [],
        priorities: ["urgent" as const, "high" as const],
        labelIds: ["label-2", "label-1", "label-2"],
        created: {},
      },
      showEmptyGroups: false,
      order: "updated" as const,
      layout: { priority: true, title: true },
      limit: 50,
    };

    const normalized = normalizeIssueQuery(query);
    expect(normalized.filter).toEqual({
      priorities: ["high", "urgent"],
      labelIds: ["label-1", "label-2"],
    });
    expect(issueQuerySchema.parse(query)).toEqual(normalized);
  });
});

describe("Rich text 契約", () => {
  it("[代表値] Markdown 互換の Tiptap document を decode し、doc 以外を拒否する", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "本文" }],
        },
      ],
    };

    expect(tiptapDocumentSchema.safeParse(document).success).toBe(true);
    expect(tiptapDocumentSchema.safeParse({ type: "paragraph", content: [] }).success).toBe(false);
  });
});

describe("Background Run 契約", () => {
  const progress = {
    current_step: "cycle_transition" as const,
    step_index: 0,
    step_count: 3 as const,
    cursor: null,
    processed: 0,
    total: 25,
    percent: 0,
  };

  it("[代表値＋境界値] RunProgress / RunError を固定形状で decode する", () => {
    expect(runProgressSchema.parse(progress)).toEqual(progress);
    expect(runProgressSchema.safeParse({ ...progress, step_count: 4 }).success).toBe(false);
    expect(runProgressSchema.safeParse({ ...progress, processed: -1 }).success).toBe(false);

    const error = {
      code: "CHUNK_FAILED",
      message: "再試行できます。",
      failed_step: "purge" as const,
      retryable: true,
      request_id: "req-456",
    };
    expect(runErrorSchema.parse(error)).toEqual(error);
  });

  it("[契約／セキュリティ境界] Run の公開 JSON に内部 token を混入できない", () => {
    expect(runProgressSchema.safeParse({ ...progress, lock_token: "secret" }).success).toBe(false);
    expect(
      runSummarySchema.safeParse({
        run_id: "run-1",
        kind: "maintenance",
        status: "running",
        progress,
        error: null,
        requested_at: 1,
        started_at: 1,
        heartbeat_at: 1,
        finished_at: null,
        resume_count: 0,
        admission_token: "secret",
      }).success,
    ).toBe(false);
  });

  it("[代表値＋契約] fixed maintenance input と continue/resume response を decode する", () => {
    expect(
      maintenanceRunCreateInputSchema.parse({
        kind: "maintenance",
        idempotencyKey: "opaque-key",
      }),
    ).toEqual({ kind: "maintenance", idempotencyKey: "opaque-key" });
    expect(
      maintenanceRunCreateInputSchema.safeParse({
        kind: "purge",
        idempotencyKey: "opaque-key",
      }).success,
    ).toBe(false);

    const continueInput = { idempotencyKey: "opaque-key", expected_cursor: null };
    expect(continueRunInputSchema.parse(continueInput)).toEqual(continueInput);
    expect(resumeRunInputSchema.parse({ idempotencyKey: "opaque-key" })).toEqual({
      idempotencyKey: "opaque-key",
    });

    const response = {
      run: {
        run_id: "run-1",
        kind: "maintenance" as const,
        status: "succeeded" as const,
        progress: { ...progress, current_step: null, step_index: 3, percent: 100 },
        error: null,
        requested_at: 1,
        started_at: 1,
        heartbeat_at: 2,
        finished_at: 3,
        resume_count: 0,
      },
      step: null,
      cursor: null,
      processed_count: 25,
      next: "none" as const,
    };
    expect(continueRunResponseSchema.parse(response)).toEqual(response);
  });
});
