import { z } from "zod";
import { prioritySchema } from "./enums";
import { boundedUnicodeString } from "./text";

export const projectNameSchema = boundedUnicodeString(
  1,
  100,
  "name must contain 1..100 Unicode code points",
);
export const projectDescriptionSchema = boundedUnicodeString(
  0,
  2_000,
  "description must contain 0..2000 Unicode code points",
);
export const projectMetadataMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  name: projectNameSchema.optional(),
  description: projectDescriptionSchema.optional(),
  statusId: z.string().min(1).optional(),
  priority: prioritySchema.optional(),
  color: z.string().min(1).max(32).optional(),
  icon: z.string().min(1).max(8).optional(),
  startAt: z.number().int().finite().nullable().optional(),
  targetAt: z.number().int().finite().nullable().optional(),
});
export const projectCreateMutationSchema = projectMetadataMutationSchema.extend({
  name: projectNameSchema,
});
export const projectReorderMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  projectId: z.string().min(1),
  beforeProjectId: z.string().min(1).nullable(),
});

export type ProjectMetadataMutation = z.infer<typeof projectMetadataMutationSchema>;
export type ProjectCreateMutation = z.infer<typeof projectCreateMutationSchema>;
export type ProjectReorderMutation = z.infer<typeof projectReorderMutationSchema>;

export const ProjectMetadataMutationSchema = projectMetadataMutationSchema;
export const ProjectCreateMutationSchema = projectCreateMutationSchema;
export const ProjectReorderMutationSchema = projectReorderMutationSchema;
