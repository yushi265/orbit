import { z } from "zod";
import { mutationMetaSchema } from "./issues";
import { boundedUnicodeString } from "./text";
import { childProgressSchema, issueSummarySchema } from "./issue-core";

export const relationTypeValues = ["blocking", "blocked_by", "related", "duplicate"] as const;
export const relationTypeSchema = z.enum(relationTypeValues);
const detailMutationMetaSchema = z.strictObject({
  idempotencyKey: mutationMetaSchema.shape.idempotencyKey,
});
export const noteBodySchema = boundedUnicodeString(
  1,
  10_000,
  "body must contain 1..10000 Unicode code points",
);
export const noteMutationSchema = z.strictObject({
  ...detailMutationMetaSchema.shape,
  body: noteBodySchema,
});
export const relationMutationSchema = z.strictObject({
  ...detailMutationMetaSchema.shape,
  targetIssueId: z.string().min(1),
  type: relationTypeSchema,
});
const publicActivityChangeSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    const privateKeyParts = ["mutationkey", "locktoken", "admissiontoken", "cookie", "email"];
    for (const key of Object.keys(value)) {
      if (privateKeyParts.some((part) => key.toLowerCase().includes(part)))
        context.addIssue({ code: "custom", message: "private activity fields are not public" });
    }
  });
export const activityViewSchema = z.strictObject({
  id: z.string().min(1),
  userId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  actorType: z.string().min(1),
  before: publicActivityChangeSchema.nullable(),
  after: publicActivityChangeSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
});
const publicIssueSchema = z.strictObject({
  id: z.string(),
  userId: z.string(),
  number: z.number().int(),
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  statusId: z.string(),
  priority: z.string(),
  estimate: z.number().nullable(),
  dueAt: z.number().nullable(),
  projectId: z.string().nullable(),
  cycleId: z.string().nullable(),
  parentId: z.string().nullable(),
  labelIds: z.array(z.string()),
  position: z.number(),
  version: z.number().int(),
  archivedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
const publicIssueSummarySchema = issueSummarySchema;
const publicNoteSchema = z.strictObject({
  id: z.string(),
  userId: z.string(),
  issueId: z.string(),
  body: z.string(),
  createdAt: z.number().int(),
  editedAt: z.number().int().nullable(),
  deletedAt: z.number().int().nullable(),
});
const publicRelationSchema = z.strictObject({
  id: z.string(),
  userId: z.string(),
  sourceIssueId: z.string(),
  targetIssueId: z.string(),
  type: relationTypeSchema,
  createdAt: z.number().int(),
  target: publicIssueSummarySchema,
});
export const issueDetailResponseSchema = z.strictObject({
  issue: publicIssueSchema,
  parent: publicIssueSummarySchema.nullable(),
  children: z.array(publicIssueSummarySchema),
  childProgress: childProgressSchema,
  notes: z.array(publicNoteSchema),
  relations: z.array(publicRelationSchema),
  activity: z.array(activityViewSchema),
});
export type RelationType = z.infer<typeof relationTypeSchema>;
export type NoteMutation = z.infer<typeof noteMutationSchema>;
export type RelationMutation = z.infer<typeof relationMutationSchema>;
