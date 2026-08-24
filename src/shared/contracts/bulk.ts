import { z } from "zod";
import { prioritySchema } from "./enums";

export const bulkIssuePatchSchema = z
  .strictObject({
    statusId: z.string().min(1).optional(),
    priority: prioritySchema.optional(),
    cycleId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    labelIds: z.array(z.string().min(1)).max(1).optional(),
  })
  .refine((patch) => Object.values(patch).filter((value) => value !== undefined).length === 1, {
    message: "exactly one bulk patch field is required",
    path: ["patch"],
  });

export const bulkIssueMutationSchema = z
  .strictObject({
    idempotencyKey: z.string().min(1),
    issueIds: z.array(z.string().min(1)).min(1).max(100),
    patch: bulkIssuePatchSchema,
  })
  .transform((input) => ({ ...input, issueIds: [...new Set(input.issueIds)] }));

export type BulkIssuePatch = z.infer<typeof bulkIssuePatchSchema>;
export type BulkIssueMutation = z.infer<typeof bulkIssueMutationSchema>;

export const BulkIssuePatchSchema = bulkIssuePatchSchema;
export const BulkIssueMutationSchema = bulkIssueMutationSchema;
