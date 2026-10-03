import { z } from "zod";
import { prioritySchema } from "./enums";
import { boundedUnicodeString } from "./text";

export const projectIssueDisplayModeSchema = z.enum(["list", "board"]);
export const projectIssueDisplayOrderSchema = z.enum([
  "manual",
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
  "title_asc",
  "title_desc",
  "status_asc",
  "status_desc",
  "priority_desc",
  "priority_asc",
  "due_asc",
  "due_desc",
]);
export const projectIssueDueFilterSchema = z.enum([
  "all",
  "none",
  "overdue",
  "today",
  "upcoming",
  "next7",
]);

const displaySelectionSchema = z.string().min(1);

export const projectIssueDisplaySettingsSchema = z.strictObject({
  mode: projectIssueDisplayModeSchema,
  filterText: boundedUnicodeString(
    0,
    255,
    "filterText は Unicode code point で 0〜255 文字である必要があります。",
  ),
  statusFilter: displaySelectionSchema,
  priorityFilter: z.union([z.literal("all"), prioritySchema]),
  labelFilter: displaySelectionSchema,
  dueFilter: projectIssueDueFilterSchema,
  showCompleted: z.boolean(),
  order: projectIssueDisplayOrderSchema,
});

export const projectDisplayPreferencesMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  displayPreferences: projectIssueDisplaySettingsSchema,
});

export type ProjectIssueDisplayMode = z.infer<typeof projectIssueDisplayModeSchema>;
export type ProjectIssueDisplayOrder = z.infer<typeof projectIssueDisplayOrderSchema>;
export type ProjectIssueDueFilter = z.infer<typeof projectIssueDueFilterSchema>;
export type ProjectIssueDisplaySettings = z.infer<typeof projectIssueDisplaySettingsSchema>;
export type ProjectDisplayPreferencesMutation = z.infer<
  typeof projectDisplayPreferencesMutationSchema
>;

export function defaultProjectIssueDisplaySettings(): ProjectIssueDisplaySettings {
  return {
    mode: "list",
    filterText: "",
    statusFilter: "all",
    priorityFilter: "all",
    labelFilter: "all",
    dueFilter: "all",
    showCompleted: true,
    order: "updated_desc",
  };
}

export const ProjectIssueDisplaySettingsSchema = projectIssueDisplaySettingsSchema;
export const ProjectDisplayPreferencesMutationSchema = projectDisplayPreferencesMutationSchema;
