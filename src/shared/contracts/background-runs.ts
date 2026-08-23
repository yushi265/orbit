import { z } from "zod";

import { runStatusSchema, runStepSchema, stepStatusSchema } from "./enums";
import { mutationMetaSchema } from "./issues";

const cursorSchema = z.string().min(1).nullable();

export const maintenanceRunCreateInputSchema = z
  .object({
    kind: z.literal("maintenance"),
    idempotencyKey: z.string().min(1),
  })
  .strict();

export const runProgressSchema = z
  .object({
    current_step: runStepSchema.nullable(),
    step_index: z.number().int().min(0).max(3),
    step_count: z.literal(3),
    cursor: cursorSchema,
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
    percent: z.number().min(0).max(100).nullable(),
  })
  .strict();

export const runErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    failed_step: runStepSchema.nullable(),
    retryable: z.boolean(),
    request_id: z.string().min(1),
  })
  .strict();

export const runSummarySchema = z
  .object({
    run_id: z.string().min(1),
    kind: z.literal("maintenance"),
    status: runStatusSchema,
    progress: runProgressSchema,
    error: runErrorSchema.nullable(),
    requested_at: z.number().int(),
    started_at: z.number().int().nullable(),
    heartbeat_at: z.number().int().nullable(),
    finished_at: z.number().int().nullable(),
    resume_count: z.number().int().nonnegative(),
  })
  .strict();

export const continueRunInputSchema = z
  .object({
    ...mutationMetaSchema.shape,
    expected_cursor: cursorSchema,
  })
  .strict();

export const resumeRunInputSchema = mutationMetaSchema;

export const continueRunResponseSchema = z
  .object({
    run: runSummarySchema,
    step: runStepSchema.nullable(),
    cursor: cursorSchema,
    processed_count: z.number().int().nonnegative(),
    next: z.enum(["continue", "resume", "none"]),
  })
  .strict();

export const runPlanSchema = z.tuple([
  z.literal("cycle_transition"),
  z.literal("purge"),
  z.literal("outbox_retry"),
]);

export const stepRecordSchema = z
  .object({
    step: runStepSchema,
    status: stepStatusSchema,
    cursor: cursorSchema,
    processed_count: z.number().int().nonnegative(),
    total_count: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type MaintenanceRunCreateInput = z.infer<typeof maintenanceRunCreateInputSchema>;
export type RunProgress = z.infer<typeof runProgressSchema>;
export type RunError = z.infer<typeof runErrorSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type ContinueRunInput = z.infer<typeof continueRunInputSchema>;
export type ResumeRunInput = z.infer<typeof resumeRunInputSchema>;
export type ContinueRunResponse = z.infer<typeof continueRunResponseSchema>;
export type RunPlan = z.infer<typeof runPlanSchema>;
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const MaintenanceRunCreateInputSchema = maintenanceRunCreateInputSchema;
export const RunProgressSchema = runProgressSchema;
export const RunErrorSchema = runErrorSchema;
export const RunSummarySchema = runSummarySchema;
export const ContinueRunInputSchema = continueRunInputSchema;
export const ResumeRunInputSchema = resumeRunInputSchema;
export const ContinueRunResponseSchema = continueRunResponseSchema;
