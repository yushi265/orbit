import { z } from "zod";

export const localeValues = ["ja", "en"] as const;
export const themeValues = ["light", "dark", "system"] as const;
export const colorThemeValues = ["coral", "ocean", "violet", "forest", "amber"] as const;
export const priorityValues = ["no_priority", "low", "medium", "high", "urgent"] as const;
export const workflowCategoryValues = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;
export const projectStatusCategoryValues = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "canceled",
] as const;
export const cycleStatusValues = ["upcoming", "active", "completed"] as const;
export const runStatusValues = [
  "pending",
  "running",
  "paused",
  "failed",
  "succeeded",
  "rejected",
] as const;
export const runStepValues = ["cycle_transition", "purge", "outbox_retry"] as const;
export const stepStatusValues = ["pending", "running", "succeeded", "failed", "skipped"] as const;

export const localeSchema = z.enum(localeValues);
export const themeSchema = z.enum(themeValues);
export const colorThemeSchema = z.enum(colorThemeValues);
export const prioritySchema = z.enum(priorityValues);
export const workflowCategorySchema = z.enum(workflowCategoryValues);
export const projectStatusCategorySchema = z.enum(projectStatusCategoryValues);
export const cycleStatusSchema = z.enum(cycleStatusValues);
export const runStatusSchema = z.enum(runStatusValues);
export const runStepSchema = z.enum(runStepValues);
export const stepStatusSchema = z.enum(stepStatusValues);
export const estimateSchema = z.union([
  z.null(),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(8),
]);

export const estimateValues = [null, 1, 2, 3, 5, 8] as const;
export const LOCALE_VALUES = localeValues;
export const THEME_VALUES = themeValues;
export const COLOR_THEME_VALUES = colorThemeValues;
export const PRIORITY_VALUES = priorityValues;
export const ESTIMATE_VALUES = estimateValues;
export const WORKFLOW_CATEGORY_VALUES = workflowCategoryValues;
export const PROJECT_STATUS_CATEGORY_VALUES = projectStatusCategoryValues;
export const CYCLE_STATUS_VALUES = cycleStatusValues;
export const RUN_STATUS_VALUES = runStatusValues;
export const RUN_STEP_VALUES = runStepValues;
export const STEP_STATUS_VALUES = stepStatusValues;
export const MAINTENANCE_RUN_STEPS = runStepValues;
export const RUN_STEP_COUNT = MAINTENANCE_RUN_STEPS.length;

export type Locale = z.infer<typeof localeSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ColorTheme = z.infer<typeof colorThemeSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type WorkflowCategory = z.infer<typeof workflowCategorySchema>;
export type ProjectStatusCategory = z.infer<typeof projectStatusCategorySchema>;
export type CycleStatus = z.infer<typeof cycleStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStep = z.infer<typeof runStepSchema>;
export type StepStatus = z.infer<typeof stepStatusSchema>;
export type Estimate = z.infer<typeof estimateSchema>;

// 短い既存コードからも wire value を参照できるよう、値配列の別名を公開する。
export const locales = localeValues;
export const themes = themeValues;
export const colorThemes = colorThemeValues;
export const priorities = priorityValues;
export const workflowCategories = workflowCategoryValues;
export const projectStatusCategories = projectStatusCategoryValues;
export const cycleStatuses = cycleStatusValues;
export const runStatuses = runStatusValues;
export const runSteps = runStepValues;
export const stepStatuses = stepStatusValues;

export const LocaleSchema = localeSchema;
export const ThemeSchema = themeSchema;
export const ColorThemeSchema = colorThemeSchema;
export const PrioritySchema = prioritySchema;
export const WorkflowCategorySchema = workflowCategorySchema;
export const ProjectStatusCategorySchema = projectStatusCategorySchema;
export const CycleStatusSchema = cycleStatusSchema;
export const RunStatusSchema = runStatusSchema;
export const RunStepSchema = runStepSchema;
export const StepStatusSchema = stepStatusSchema;
export const EstimateSchema = estimateSchema;
