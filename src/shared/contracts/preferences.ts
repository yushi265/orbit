import { z } from "zod";
import { colorThemeSchema, localeSchema, themeSchema } from "./enums";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .min(1, "timezone is required")
  .max(64, "timezone must be at most 64 characters")
  .refine((value) => value.trim() === value && isValidTimeZone(value), {
    message: "timezone must be a valid IANA timezone",
  });

export const preferencesMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  timezone: timezoneSchema.optional(),
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  colorTheme: colorThemeSchema.optional(),
  estimateEnabled: z.boolean().optional(),
});

export type PreferencesMutation = z.infer<typeof preferencesMutationSchema>;

export const TimezoneSchema = timezoneSchema;
export const PreferencesMutationSchema = preferencesMutationSchema;
