import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";

import {
  activityEvents,
  backgroundEffectDedupes,
  backgroundRunSteps,
  backgroundRuns,
  cycleIssueHistory,
  cycles,
  cycleSettings,
  issueLabels,
  issueNotes,
  issueRelations,
  issues,
  labels,
  mutationReceipts,
  notificationPreferences,
  notifications,
  orbitStoreSnapshots,
  outboxEvents,
  projectStatuses,
  projects,
  recentIssueViews,
  recentSearches,
  savedViews,
  userPreferences,
  userRuntimeLocks,
  users,
  workflowStates,
} from "./schema";

const schemaTables = {
  users,
  userPreferences,
  workflowStates,
  cycleSettings,
  cycles,
  projectStatuses,
  projects,
  issues,
  labels,
  issueLabels,
  issueRelations,
  issueNotes,
  cycleIssueHistory,
  savedViews,
  recentIssueViews,
  recentSearches,
  notifications,
  notificationPreferences,
  activityEvents,
  outboxEvents,
  mutationReceipts,
  backgroundRuns,
  backgroundRunSteps,
  backgroundEffectDedupes,
  userRuntimeLocks,
  orbitStoreSnapshots,
} as const;

function tableConfig(table: (typeof schemaTables)[keyof typeof schemaTables]) {
  return getTableConfig(table);
}

function columnNames(table: (typeof schemaTables)[keyof typeof schemaTables]) {
  return tableConfig(table).columns.map((column) => column.name);
}

function hasIndex(
  table: (typeof schemaTables)[keyof typeof schemaTables],
  columns: string[],
  unique?: boolean,
) {
  const config = tableConfig(table);
  const matches = (actualColumns: readonly unknown[]) =>
    actualColumns
      .map((column) => {
        if (typeof column === "object" && column !== null && "name" in column) {
          return String((column as { name: unknown }).name);
        }
        return "";
      })
      .join(",") === columns.join(",");

  if (
    unique === true &&
    config.uniqueConstraints.some((constraint) => matches(constraint.columns))
  ) {
    return true;
  }

  return config.indexes.some((index) => {
    if (unique !== undefined && index.config.unique !== unique) return false;
    return matches(index.config.columns);
  });
}

describe("Drizzle schema", () => {
  it("[代表値] spec の全業務 table を wire name で公開する", () => {
    expect(
      Object.fromEntries(
        Object.entries(schemaTables).map(([key, table]) => [key, getTableName(table)]),
      ),
    ).toEqual({
      users: "users",
      userPreferences: "user_preferences",
      workflowStates: "workflow_states",
      cycleSettings: "cycle_settings",
      cycles: "cycles",
      projectStatuses: "project_statuses",
      projects: "projects",
      issues: "issues",
      labels: "labels",
      issueLabels: "issue_labels",
      issueRelations: "issue_relations",
      issueNotes: "issue_notes",
      cycleIssueHistory: "cycle_issue_history",
      savedViews: "saved_views",
      recentIssueViews: "recent_issue_views",
      recentSearches: "recent_searches",
      notifications: "notifications",
      orbitStoreSnapshots: "orbit_store_snapshots",
      notificationPreferences: "notification_preferences",
      activityEvents: "activity_events",
      outboxEvents: "outbox_events",
      mutationReceipts: "mutation_receipts",
      backgroundRuns: "background_runs",
      backgroundRunSteps: "background_run_steps",
      backgroundEffectDedupes: "background_effect_dedupes",
      userRuntimeLocks: "user_runtime_locks",
    });
  });

  it("[代表値] Issue / Background Run の JSON・CAS・owner 列を保持する", () => {
    expect(columnNames(issues)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "number",
        "title",
        "description_json",
        "description_text",
        "status_id",
        "priority",
        "estimate",
        "version",
        "last_mutation_key",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columnNames(backgroundRuns)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "kind",
        "status",
        "plan_json",
        "progress_json",
        "error_json",
        "idempotency_key",
        "request_hash",
        "admission_token",
        "lease_expires_at",
        "resume_count",
      ]),
    );
    expect(columnNames(backgroundRunSteps)).toEqual(
      expect.arrayContaining(["run_id", "user_id", "step", "status", "cursor", "dedupe_key"]),
    );
    expect(columnNames(orbitStoreSnapshots)).toEqual([
      "user_id",
      "version",
      "state_json",
      "updated_at",
    ]);
  });

  it("[代表値＋制約] owner 境界と主要な unique / index を schema に持つ", () => {
    expect(tableConfig(userPreferences).foreignKeys.length).toBeGreaterThan(0);
    expect(tableConfig(issues).foreignKeys.length).toBeGreaterThan(0);
    expect(tableConfig(backgroundRunSteps).foreignKeys.length).toBeGreaterThan(0);
    expect(tableConfig(userRuntimeLocks).foreignKeys.length).toBeGreaterThan(0);
    expect(tableConfig(orbitStoreSnapshots).foreignKeys.length).toBeGreaterThan(0);

    expect(hasIndex(issues, ["user_id", "status_id", "updated_at"])).toBe(true);
    expect(hasIndex(issues, ["user_id", "cycle_id", "position"])).toBe(true);
    expect(hasIndex(issues, ["user_id", "project_id", "status_id", "position"])).toBe(true);
    expect(hasIndex(issues, ["user_id", "number"], true)).toBe(true);
    expect(hasIndex(workflowStates, ["user_id"], true)).toBe(true);
    expect(hasIndex(projectStatuses, ["user_id"], true)).toBe(true);
    expect(hasIndex(cycles, ["user_id", "number"], true)).toBe(true);
    expect(hasIndex(mutationReceipts, ["user_id", "idempotency_key"], true)).toBe(true);
    expect(hasIndex(backgroundRunSteps, ["run_id", "step"], true)).toBe(true);
    expect(hasIndex(backgroundEffectDedupes, ["user_id", "step", "dedupe_key"], true)).toBe(true);
    expect(columnNames(recentIssueViews)).toEqual(["user_id", "issue_id", "viewed_at"]);
    expect(columnNames(recentSearches)).toEqual(
      expect.arrayContaining(["normalized_query_json", "searched_at"]),
    );
  });
});
