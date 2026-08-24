import { z } from "zod";

export const errorCodeValues = [
  "AUTH_REQUIRED",
  "VALIDATION_ERROR",
  "RESOURCE_NOT_FOUND",
  "ISSUE_VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "D1_WRITE_CONFLICT",
  "OPERATION_IN_PROGRESS",
  "RUN_REQUIRES_RESUME",
  "BACKGROUND_RUN_REJECTED",
  "INTERNAL_ERROR",
] as const;

export const errorCodeSchema = z.enum(errorCodeValues);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const ERROR_STATUS_BY_CODE: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  VALIDATION_ERROR: 400,
  RESOURCE_NOT_FOUND: 404,
  ISSUE_VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  D1_WRITE_CONFLICT: 409,
  OPERATION_IN_PROGRESS: 423,
  RUN_REQUIRES_RESUME: 409,
  BACKGROUND_RUN_REJECTED: 409,
  INTERNAL_ERROR: 500,
};

export const errorFieldErrorsSchema = z.record(z.string(), z.array(z.string()));

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1),
        fieldErrors: errorFieldErrorsSchema.optional(),
        requestId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function errorStatusForCode(code: ErrorCode): number {
  return ERROR_STATUS_BY_CODE[code];
}

export function createErrorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: Record<string, string[]>,
): ErrorEnvelope {
  return errorEnvelopeSchema.parse({
    error: { code, message, requestId, ...(fieldErrors === undefined ? {} : { fieldErrors }) },
  });
}

export const ErrorCodeSchema = errorCodeSchema;
export const ErrorEnvelopeSchema = errorEnvelopeSchema;
export const HTTP_STATUS_BY_ERROR_CODE = ERROR_STATUS_BY_CODE;
export const ERROR_CODE_STATUS = ERROR_STATUS_BY_CODE;
export const httpStatusForErrorCode = errorStatusForCode;
