import { z } from "zod";
import { mutationMetaSchema } from "./issues";
import { boundedUnicodeString } from "./text";

export const cycleNameOverrideSchema = boundedUnicodeString(
  1,
  100,
  "nameOverride must contain 1..100 Unicode code points",
);
export const cycleDescriptionSchema = boundedUnicodeString(
  0,
  2_000,
  "description must contain 0..2000 Unicode code points",
);
export const cycleMetadataMutationSchema = z.strictObject({
  idempotencyKey: mutationMetaSchema.shape.idempotencyKey,
  nameOverride: cycleNameOverrideSchema.nullable().optional(),
  description: cycleDescriptionSchema.optional(),
});

export const cycleStartMutationSchema = z.strictObject({
  idempotencyKey: mutationMetaSchema.shape.idempotencyKey,
});

export type CycleMetadataMutation = z.infer<typeof cycleMetadataMutationSchema>;
export type CycleStartMutation = z.infer<typeof cycleStartMutationSchema>;

export const CycleMetadataMutationSchema = cycleMetadataMutationSchema;
export const CycleStartMutationSchema = cycleStartMutationSchema;
