import { describe, expect, it } from "vitest";

import {
  CYCLE_STATUS_VALUES,
  ESTIMATE_VALUES,
  LOCALE_VALUES,
  PRIORITY_VALUES,
  PROJECT_STATUS_CATEGORY_VALUES,
  RUN_STATUS_VALUES,
  RUN_STEP_VALUES,
  STEP_STATUS_VALUES,
  THEME_VALUES,
  WORKFLOW_CATEGORY_VALUES,
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
} from "./enums";
import {
  ERROR_CODE_STATUS,
  errorEnvelopeSchema,
  errorCodeSchema,
  httpStatusForErrorCode,
} from "./errors";
import { createIssueInputSchema, issueQuerySchema, updateIssueInputSchema } from "./issues";
import {
  continueRunInputSchema,
  continueRunResponseSchema,
  maintenanceRunCreateInputSchema,
  resumeRunInputSchema,
  runErrorSchema,
  runProgressSchema,
  runSummarySchema,
} from "./background-runs";
import { tiptapDocumentSchema } from "./rich-text";
import { canonicalJson, canonicalizeIssueFilter } from "../canonical-json";
import { classifyTransportFailure } from "../transport";

describe("共有 wire enum", () => {
  it("仕様で固定された wire value だけを受け入れる", () => {
    expect(LOCALE_VALUES).toEqual(["ja", "en"]);
    expect(THEME_VALUES).toEqual(["light", "dark", "system"]);
    expect(PRIORITY_VALUES).toEqual(["no_priority", "low", "medium", "high", "urgent"]);
    expect(ESTIMATE_VALUES).toEqual([null, 1, 2, 3, 5, 8]);
    expect(WORKFLOW_CATEGORY_VALUES).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
    ]);
    expect(PROJECT_STATUS_CATEGORY_VALUES).toEqual([
      "backlog",
      "planned",
      "in_progress",
      "completed",
      "canceled",
    ]);
    expect(CYCLE_STATUS_VALUES).toEqual(["upcoming", "active", "completed"]);
    expect(RUN_STATUS_VALUES).toEqual([
      "pending",
      "running",
      "paused",
      "failed",
      "succeeded",
      "rejected",
    ]);
    expect(RUN_STEP_VALUES).toEqual(["cycle_transition", "purge", "outbox_retry"]);
    expect(STEP_STATUS_VALUES).toEqual(["pending", "running", "succeeded", "failed", "skipped"]);

    expect(localeSchema.safeParse("ja").success).toBe(true);
    expect(themeSchema.safeParse("system").success).toBe(true);
    expect(prioritySchema.safeParse("high").success).toBe(true);
    expect(estimateSchema.safeParse(null).success).toBe(true);
    expect(estimateSchema.safeParse(4).success).toBe(false);
    expect(workflowCategorySchema.safeParse("started").success).toBe(true);
    expect(projectStatusCategorySchema.safeParse("in_progress").success).toBe(true);
    expect(cycleStatusSchema.safeParse("active").success).toBe(true);
    expect(runStatusSchema.safeParse("paused").success).toBe(true);
    expect(runStepSchema.safeParse("purge").success).toBe(true);
    expect(stepStatusSchema.safeParse("skipped").success).toBe(true);
  });
});

describe("ErrorEnvelope", () => {
  it("各 error code を指定 HTTP status へ一意に対応付ける", () => {
    expect(ERROR_CODE_STATUS).toEqual({
      AUTH_REQUIRED: 401,
      VALIDATION_ERROR: 400,
      RESOURCE_NOT_FOUND: 404,
      ISSUE_VERSION_CONFLICT: 409,
      IDEMPOTENCY_KEY_REUSED: 409,
      OPERATION_IN_PROGRESS: 423,
      RUN_REQUIRES_RESUME: 409,
      BACKGROUND_RUN_REJECTED: 409,
      INTERNAL_ERROR: 500,
    });

    for (const [code, status] of Object.entries(ERROR_CODE_STATUS)) {
      expect(errorCodeSchema.safeParse(code).success).toBe(true);
      expect(httpStatusForErrorCode(code as keyof typeof ERROR_CODE_STATUS)).toBe(status);
    }
  });

  it("requestId と任意 fieldErrors を含む envelope を検証する", () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: {
          code: "VALIDATION_ERROR",
          message: "入力を確認してください",
          fieldErrors: { title: ["必須です"] },
          requestId: "request-1",
        },
      }).success,
    ).toBe(true);
  });

  it("公開契約へ lock/admission token を混入させない", () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: {
          code: "INTERNAL_ERROR",
          message: "安全なエラー",
          requestId: "request-1",
          lock_token: "must-not-leak",
        },
      }).success,
    ).toBe(false);
  });
});

describe("Issue 契約", () => {
  const baseInput = {
    idempotencyKey: "opaque-key",
    title: "最初の Issue",
    priority: "high" as const,
    estimate: 3 as const,
    dueAt: 1_700_000_000_000,
    labelIds: ["label-1"],
  };

  it("title は Unicode code point で 1..255 を境界にする", () => {
    expect(createIssueInputSchema.safeParse({ ...baseInput, title: "" }).success).toBe(false);
    expect(createIssueInputSchema.safeParse({ ...baseInput, title: "😀" }).success).toBe(true);
    expect(
      createIssueInputSchema.safeParse({
        ...baseInput,
        title: Array.from({ length: 255 }, () => "😀").join(""),
      }).success,
    ).toBe(true);
    expect(
      createIssueInputSchema.safeParse({
        ...baseInput,
        title: Array.from({ length: 256 }, () => "😀").join(""),
      }).success,
    ).toBe(false);
  });

  it("create/update/query の固定形と version を検証する", () => {
    expect(
      createIssueInputSchema.safeParse({
        ...baseInput,
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "本文" }] }],
        },
        projectId: null,
        cycleId: null,
        parentId: null,
      }).success,
    ).toBe(true);

    expect(
      updateIssueInputSchema.safeParse({
        idempotencyKey: "opaque-key",
        version: 1,
        id: "issue-1",
        patch: { title: "更新後" },
      }).success,
    ).toBe(true);
    expect(
      updateIssueInputSchema.safeParse({
        idempotencyKey: "opaque-key",
        id: "issue-1",
        patch: { title: "version なし" },
      }).success,
    ).toBe(false);
    expect(
      updateIssueInputSchema.safeParse({
        idempotencyKey: "opaque-key",
        version: 1,
        id: "issue-1",
        patch: { title: "更新後", unknown: true },
      }).success,
    ).toBe(false);

    expect(
      issueQuerySchema.safeParse({
        mode: "list",
        filter: { priorities: ["high"], projectIds: [] },
        showEmptyGroups: false,
        order: "updated",
        layout: { title: true, estimate: false },
        cursor: "opaque-cursor",
        limit: 50,
      }).success,
    ).toBe(true);
    expect(
      issueQuerySchema.safeParse({
        mode: "list",
        filter: { or: [{ priorities: ["high"] }] },
        showEmptyGroups: false,
        order: "updated",
        layout: {},
        limit: 50,
      }).success,
    ).toBe(false);
  });
});

describe("canonical filter / JSON", () => {
  it("空条件を落とし、集合値を重複排除・ソートして同じ JSON にする", () => {
    const first = canonicalizeIssueFilter({
      statusIds: ["status-2", "status-1", "status-2"],
      projectIds: [],
      priorities: ["high", "low"],
      created: { to: 20, from: 10 },
    });
    const second = canonicalizeIssueFilter({
      created: { from: 10, to: 20 },
      priorities: ["low", "high"],
      statusIds: ["status-1", "status-2"],
    });

    expect(first).toEqual(second);
    expect(first).toEqual({
      statusIds: ["status-1", "status-2"],
      priorities: ["high", "low"],
      created: { from: 10, to: 20 },
    });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  it("object key の順序を固定し、配列順は意味として保持する", () => {
    expect(
      canonicalJson({
        z: 1,
        a: { d: 2, c: 1 },
        items: [
          { b: 2, a: 1 },
          { a: 3, b: 4 },
        ],
      }),
    ).toBe('{"a":{"c":1,"d":2},"items":[{"a":1,"b":2},{"a":3,"b":4}],"z":1}');
  });
});

describe("Background Run 契約", () => {
  const progress = {
    current_step: "cycle_transition" as const,
    step_index: 0,
    step_count: 3 as const,
    cursor: null,
    processed: 0,
    total: 10,
    percent: 0,
  };

  it("固定 schema、progress、error、summary を検証する", () => {
    expect(
      maintenanceRunCreateInputSchema.safeParse({
        kind: "maintenance",
        idempotencyKey: "run-key",
      }).success,
    ).toBe(true);
    expect(
      maintenanceRunCreateInputSchema.safeParse({
        kind: "other",
        idempotencyKey: "run-key",
      }).success,
    ).toBe(false);
    expect(runProgressSchema.safeParse(progress).success).toBe(true);
    expect(runProgressSchema.safeParse({ ...progress, step_count: 4 }).success).toBe(false);
    expect(
      runErrorSchema.safeParse({
        code: "D1_TEMPORARY_FAILURE",
        message: "再試行可能なエラー",
        failed_step: "purge",
        retryable: true,
        request_id: "request-1",
      }).success,
    ).toBe(true);
    expect(
      runSummarySchema.safeParse({
        run_id: "run-1",
        kind: "maintenance",
        status: "running",
        progress,
        error: null,
        requested_at: 1_700_000_000_000,
        started_at: 1_700_000_000_001,
        heartbeat_at: 1_700_000_000_002,
        finished_at: null,
        resume_count: 0,
      }).success,
    ).toBe(true);
  });

  it("continue/resume の入力と response を検証する", () => {
    expect(
      continueRunInputSchema.safeParse({
        idempotencyKey: "continue-key",
        expected_cursor: null,
      }).success,
    ).toBe(true);
    expect(resumeRunInputSchema.safeParse({ idempotencyKey: "resume-key" }).success).toBe(true);
    expect(
      continueRunResponseSchema.safeParse({
        run: {
          run_id: "run-1",
          kind: "maintenance",
          status: "succeeded",
          progress: { ...progress, current_step: null, step_index: 3 },
          error: null,
          requested_at: 1_700_000_000_000,
          started_at: 1_700_000_000_001,
          heartbeat_at: null,
          finished_at: 1_700_000_000_010,
          resume_count: 0,
        },
        step: "outbox_retry",
        cursor: "opaque-cursor",
        processed_count: 10,
        next: "none",
      }).success,
    ).toBe(true);
  });

  it("公開 progress/summary に token や未定義フィールドを受け入れない", () => {
    expect(runProgressSchema.safeParse({ ...progress, lock_token: "private" }).success).toBe(false);
    expect(
      runSummarySchema.safeParse({
        run_id: "run-1",
        kind: "maintenance",
        status: "running",
        progress,
        error: null,
        requested_at: 1_700_000_000_000,
        started_at: null,
        heartbeat_at: null,
        finished_at: null,
        resume_count: 0,
        admission_token: "private",
      }).success,
    ).toBe(false);
  });
});

describe("Tiptap document / transport", () => {
  it("plain Tiptap document の境界を検証する", () => {
    expect(
      tiptapDocumentSchema.safeParse({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "本文" }] }],
      }).success,
    ).toBe(true);
    expect(tiptapDocumentSchema.safeParse({ type: "html" }).success).toBe(false);
  });

  it("401 と offline/timeout/5xx を別分類にする", () => {
    expect(classifyTransportFailure({ status: 401 })).toEqual("auth_required");
    expect(classifyTransportFailure({ status: 500 })).toEqual("server_error");
    expect(classifyTransportFailure({ status: 408 })).toEqual("timeout");
    expect(classifyTransportFailure({ offline: true })).toEqual("offline");
  });
});
