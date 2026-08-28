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

export const cycleDurationWeeksSchema = z
  .number()
  .int("durationWeeks must be an integer")
  .min(1, "durationWeeks must be between 1 and 8")
  .max(8, "durationWeeks must be between 1 and 8");
export const cycleStartWeekdaySchema = z
  .number()
  .int("startWeekday must be an integer")
  .min(0, "startWeekday must be between 0 and 6")
  .max(6, "startWeekday must be between 0 and 6");
export const cycleCooldownWeeksSchema = z
  .number()
  .int("cooldownWeeks must be an integer")
  .min(0, "cooldownWeeks must be between 0 and 4")
  .max(4, "cooldownWeeks must be between 0 and 4");
export const cycleFutureCountSchema = z
  .number()
  .int("futureCount must be an integer")
  .min(1, "futureCount must be between 1 and 15")
  .max(15, "futureCount must be between 1 and 15");
export const cycleSettingsMutationSchema = z.strictObject({
  idempotencyKey: mutationMetaSchema.shape.idempotencyKey.max(200),
  durationWeeks: cycleDurationWeeksSchema,
  startWeekday: cycleStartWeekdaySchema,
  cooldownWeeks: cycleCooldownWeeksSchema.optional(),
  futureCount: cycleFutureCountSchema.optional(),
});

export type CycleMetadataMutation = z.infer<typeof cycleMetadataMutationSchema>;
export type CycleStartMutation = z.infer<typeof cycleStartMutationSchema>;
export type CycleSettingsMutation = z.infer<typeof cycleSettingsMutationSchema>;

export const CycleMetadataMutationSchema = cycleMetadataMutationSchema;
export const CycleStartMutationSchema = cycleStartMutationSchema;
export const CycleSettingsMutationSchema = cycleSettingsMutationSchema;
