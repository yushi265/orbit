import { z } from "zod";
import { issueQuerySchema } from "./issues";
import { boundedUnicodeString } from "./text";

export const savedViewNameSchema = boundedUnicodeString(
  1,
  80,
  "name must contain 1..80 Unicode code points",
);
const layoutSchema = z.record(z.string(), z.boolean());
export const savedViewMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  name: savedViewNameSchema,
  query: issueQuerySchema,
  layout: layoutSchema.optional(),
});
export const savedViewUpdateSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  name: savedViewNameSchema.optional(),
  query: issueQuerySchema.optional(),
  layout: layoutSchema.optional(),
});

export type SavedViewMutation = z.infer<typeof savedViewMutationSchema>;
export type SavedViewUpdate = z.infer<typeof savedViewUpdateSchema>;

export const SavedViewMutationSchema = savedViewMutationSchema;
export const SavedViewUpdateSchema = savedViewUpdateSchema;
