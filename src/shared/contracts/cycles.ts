import { z } from "zod";
import { mutationMetaSchema } from "./issues";
import { boundedUnicodeString } from "./text";

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const cycleDateSchema = z
  .string()
  .refine(isCalendarDate, "date must be a valid YYYY-MM-DD calendar date");

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
  autoAddToCurrentCycle: z.boolean().optional(),
});

export const cycleScheduleMutationSchema = z.strictObject({
  idempotencyKey: mutationMetaSchema.shape.idempotencyKey.max(200),
  startDate: cycleDateSchema,
  endDate: cycleDateSchema,
});

export type CycleMetadataMutation = z.infer<typeof cycleMetadataMutationSchema>;
export type CycleStartMutation = z.infer<typeof cycleStartMutationSchema>;
export type CycleSettingsMutation = z.infer<typeof cycleSettingsMutationSchema>;
export type CycleScheduleMutation = z.infer<typeof cycleScheduleMutationSchema>;

export const CycleMetadataMutationSchema = cycleMetadataMutationSchema;
export const CycleStartMutationSchema = cycleStartMutationSchema;
export const CycleSettingsMutationSchema = cycleSettingsMutationSchema;
export const CycleScheduleMutationSchema = cycleScheduleMutationSchema;
