import { z } from "zod";

export function boundedUnicodeString(min: number, max: number, message: string) {
  return z.string().superRefine((value, context) => {
    const length = Array.from(value).length;
    if (length < min || length > max) context.addIssue({ code: "custom", message });
  });
}
