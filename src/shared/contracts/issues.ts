import { z } from "zod";

import { estimateSchema, prioritySchema, type Priority } from "./enums";
import { tiptapDocumentSchema } from "./rich-text";
import { boundedUnicodeString } from "./text";

const opaqueIdSchema = z.string().min(1);
const unixMillisecondsSchema = z.number().int().finite();

export const mutationMetaSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    version: z.number().int().nonnegative().optional(),
  })
  .strict();

const issueFieldsShape = {
  title: boundedUnicodeString(
    1,
    255,
    "title は Unicode code point で 1〜255 文字である必要があります。",
  ),
  descriptionJson: tiptapDocumentSchema.optional(),
  statusId: opaqueIdSchema.optional(),
  priority: prioritySchema.optional(),
  estimate: estimateSchema.optional(),
  dueAt: unixMillisecondsSchema.nullable().optional(),
  projectId: opaqueIdSchema.nullable().optional(),
  cycleId: opaqueIdSchema.nullable().optional(),
  parentId: opaqueIdSchema.nullable().optional(),
  labelIds: z.array(opaqueIdSchema).optional(),
} as const;

export const createIssueInputSchema = z
  .object({
    ...mutationMetaSchema.shape,
    ...issueFieldsShape,
  })
  .strict();

export const updateIssueInputSchema = z
  .object({
    id: opaqueIdSchema,
    idempotencyKey: z.string().min(1),
    version: z.number().int().nonnegative(),
    patch: z.object(issueFieldsShape).partial().strict(),
  })
  .strict();

export const reorderIssueInputSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    issueId: opaqueIdSchema,
    version: z.number().int().nonnegative(),
    beforeIssueId: opaqueIdSchema.nullable(),
    projectId: opaqueIdSchema.optional(),
    cycleId: opaqueIdSchema.optional(),
    statusId: opaqueIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.statusId !== undefined && value.cycleId === undefined)
      context.addIssue({
        code: "custom",
        path: ["cycleId"],
        message: "statusIdを指定する場合はcycleIdが必要です。",
      });
  });

const issueDueSchema = z.enum(["none", "overdue", "today", "upcoming", "next7"]);
const issueGroupSchema = z.enum(["status", "priority", "project", "cycle", "label"]);
const issueOrderSchema = z.enum(["manual", "priority", "updated", "created", "due_at", "estimate"]);

const createdRangeSchema = z
  .object({
    from: unixMillisecondsSchema.optional(),
    to: unixMillisecondsSchema.optional(),
  })
  .strict()
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    message: "created.from は created.to 以下である必要があります。",
    path: ["from"],
  });

export const issueFilterSchema = z
  .object({
    text: boundedUnicodeString(
      1,
      255,
      "検索語はUnicode code pointで1〜255文字である必要があります。",
    )
      .refine((value) => value.trim().length > 0, "検索語は空白だけにできません。")
      .optional(),
    statusIds: z.array(opaqueIdSchema).optional(),
    priorities: z.array(prioritySchema).optional(),
    labelIds: z.array(opaqueIdSchema).optional(),
    projectIds: z.array(opaqueIdSchema).optional(),
    cycleIds: z.array(opaqueIdSchema).optional(),
    due: issueDueSchema.optional(),
    created: createdRangeSchema.optional(),
  })
  .strict();

const issueQueryBaseSchema = z
  .object({
    mode: z.enum(["list", "board"]),
    filter: issueFilterSchema,
    group: issueGroupSchema.optional(),
    showEmptyGroups: z.boolean(),
    order: issueOrderSchema,
    layout: z.record(z.string(), z.boolean()),
    cursor: opaqueIdSchema.optional(),
    limit: z.number().int().min(1),
  })
  .strict();

// GET /api/v1/issues のクエリ文字列。空文字は呼び出し側で未指定（undefined）へ寄せてから渡す。
export const issueListParamsSchema = z
  .object({
    due: issueDueSchema.optional(),
    order: issueOrderSchema.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export type IssueFilter = z.infer<typeof issueFilterSchema>;
export type IssueQuery = z.infer<typeof issueQueryBaseSchema>;
export type CreateIssueInput = z.infer<typeof createIssueInputSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueInputSchema>;
export type ReorderIssueInput = z.infer<typeof reorderIssueInputSchema>;

const sortableFilterKeys = [
  "statusIds",
  "priorities",
  "labelIds",
  "projectIds",
  "cycleIds",
] as const;

function sortedUnique(values: string[] | Priority[]): string[] | Priority[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeIssueFilter(filter: IssueFilter): IssueFilter {
  const normalized: IssueFilter = {};

  if (filter.text?.trim()) normalized.text = filter.text.trim();

  for (const key of sortableFilterKeys) {
    const values = filter[key];
    if (values !== undefined && values.length > 0) {
      normalized[key] = sortedUnique(values) as never;
    }
  }

  if (filter.due !== undefined) {
    normalized.due = filter.due;
  }

  if (filter.created !== undefined) {
    const created = Object.fromEntries(
      Object.entries(filter.created).filter(([, value]) => value !== undefined),
    ) as IssueFilter["created"];
    if (created !== undefined && Object.keys(created).length > 0) {
      normalized.created = created;
    }
  }

  return normalized;
}

export function normalizeIssueQuery(query: IssueQuery): IssueQuery {
  return {
    ...query,
    filter: normalizeIssueFilter(query.filter),
  };
}

export const issueQuerySchema = issueQueryBaseSchema.transform(normalizeIssueQuery);

export const MutationMetaSchema = mutationMetaSchema;
export const CreateIssueInputSchema = createIssueInputSchema;
export const UpdateIssueInputSchema = updateIssueInputSchema;
export const ReorderIssueInputSchema = reorderIssueInputSchema;
export const IssueFilterSchema = issueFilterSchema;
export const IssueQuerySchema = issueQuerySchema;
