import { z } from "zod";
import { boundedUnicodeString } from "./text";

export const labelNameSchema = boundedUnicodeString(
  1,
  50,
  "name must contain 1..50 Unicode code points",
);
export const labelColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex value");

export const labelMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  name: labelNameSchema,
  color: labelColorSchema,
});
export const labelUpdateSchema = z
  .strictObject({
    idempotencyKey: z.string().min(1),
    name: labelNameSchema.optional(),
    color: labelColorSchema.optional(),
  })
  .refine(({ name, color }) => name !== undefined || color !== undefined, {
    message: "name or color is required",
    path: ["name"],
  });

export type LabelMutation = z.infer<typeof labelMutationSchema>;
export type LabelUpdate = z.infer<typeof labelUpdateSchema>;

export const LabelMutationSchema = labelMutationSchema;
export const LabelUpdateSchema = labelUpdateSchema;
