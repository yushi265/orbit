import { z } from "zod";
import { workflowCategorySchema } from "./enums";
import { boundedUnicodeString } from "./text";

export const workflowStateNameSchema = boundedUnicodeString(
  1,
  100,
  "name must contain 1..100 Unicode code points",
).refine((value) => value.trim().length > 0, "name must not be blank");
export const workflowStateColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB value");

export const workflowStateCreateMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  name: workflowStateNameSchema,
  category: workflowCategorySchema,
  color: workflowStateColorSchema,
  isDefault: z.boolean().optional(),
});

export const workflowStateUpdateMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  name: workflowStateNameSchema.optional(),
  color: workflowStateColorSchema.optional(),
  position: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
});

export type WorkflowStateCreateMutation = z.infer<typeof workflowStateCreateMutationSchema>;
export type WorkflowStateUpdateMutation = z.infer<typeof workflowStateUpdateMutationSchema>;

export const WorkflowStateNameSchema = workflowStateNameSchema;
export const WorkflowStateColorSchema = workflowStateColorSchema;
export const WorkflowStateCreateMutationSchema = workflowStateCreateMutationSchema;
export const WorkflowStateUpdateMutationSchema = workflowStateUpdateMutationSchema;
