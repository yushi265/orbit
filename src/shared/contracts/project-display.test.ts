import { describe, expect, it } from "vitest";
import {
  defaultProjectIssueDisplaySettings,
  projectDisplayPreferencesMutationSchema,
  projectIssueDisplaySettingsSchema,
} from "./project-display";

const settings = defaultProjectIssueDisplaySettings();

describe("Project issue display contract", () => {
  it("[代表値] 初期値はProject workspaceの表示契約を満たす", () => {
    expect(projectIssueDisplaySettingsSchema.parse(settings)).toEqual({
      mode: "list",
      filterText: "",
      statusFilter: "all",
      priorityFilter: "all",
      labelFilter: "all",
      dueFilter: "all",
      showCompleted: true,
      order: "updated_desc",
    });
  });

  it("[同値分割] すべての表示形式・Filter・Orderを受理する", () => {
    for (const mode of ["list", "board"] as const)
      expect(projectIssueDisplaySettingsSchema.safeParse({ ...settings, mode }).success).toBe(true);
    for (const priorityFilter of ["all", "no_priority", "low", "medium", "high", "urgent"] as const)
      expect(
        projectIssueDisplaySettingsSchema.safeParse({ ...settings, priorityFilter }).success,
      ).toBe(true);
    for (const dueFilter of ["all", "none", "overdue", "today", "upcoming"] as const)
      expect(projectIssueDisplaySettingsSchema.safeParse({ ...settings, dueFilter }).success).toBe(
        true,
      );
    for (const order of [
      "manual",
      "updated_desc",
      "created_desc",
      "title_asc",
      "status_asc",
      "priority_desc",
      "due_asc",
    ] as const)
      expect(projectIssueDisplaySettingsSchema.safeParse({ ...settings, order }).success).toBe(
        true,
      );
    expect(
      projectIssueDisplaySettingsSchema.safeParse({
        ...settings,
        statusFilter: "status-1",
        labelFilter: "label-1",
        showCompleted: false,
      }).success,
    ).toBe(true);
  });

  it("[境界値] filterTextは255文字までで256文字を拒否する", () => {
    expect(
      projectIssueDisplaySettingsSchema.safeParse({ ...settings, filterText: "あ".repeat(255) })
        .success,
    ).toBe(true);
    expect(
      projectIssueDisplaySettingsSchema.safeParse({ ...settings, filterText: "あ".repeat(256) })
        .success,
    ).toBe(false);
  });

  it("[契約] Mutationは未知キーとdisplayPreferences欠落を拒否する", () => {
    expect(
      projectDisplayPreferencesMutationSchema.safeParse({
        idempotencyKey: "display-1",
        displayPreferences: settings,
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      projectDisplayPreferencesMutationSchema.safeParse({ idempotencyKey: "display-2" }).success,
    ).toBe(false);
    for (const displayPreferences of [null, [], 1, "settings"]) {
      expect(
        projectDisplayPreferencesMutationSchema.safeParse({
          idempotencyKey: "display-invalid-value",
          displayPreferences,
        }).success,
      ).toBe(false);
    }
  });
});
