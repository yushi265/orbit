import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("初期 Drizzle migration", () => {
  it("25テーブル、固定Run、owner/idempotencyのDDLを含む", () => {
    const migrationDirectory = resolve(process.cwd(), "drizzle");
    const migrationFile = readdirSync(migrationDirectory)
      .filter((name) => /^0000_.*\.sql$/.test(name))
      .sort()[0];

    expect(migrationFile).toBeDefined();
    const migration = readFileSync(resolve(migrationDirectory, migrationFile), "utf8");

    for (const tableName of [
      "users",
      "user_preferences",
      "workflow_states",
      "cycle_settings",
      "cycles",
      "project_statuses",
      "projects",
      "issues",
      "labels",
      "issue_labels",
      "issue_relations",
      "issue_notes",
      "cycle_issue_history",
      "saved_views",
      "recent_issue_views",
      "recent_searches",
      "notifications",
      "notification_preferences",
      "activity_events",
      "outbox_events",
      "mutation_receipts",
      "background_runs",
      "background_run_steps",
      "background_effect_dedupes",
      "user_runtime_locks",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${tableName}\``);
    }

    expect(migration).toContain("idempotency_key");
    expect(migration).toContain("admission_token");
    expect(migration).toContain("'cycle_transition'");
    expect(migration).toContain("background_run_steps_run_step_unique");
    expect(migration).toContain("background_effect_dedupes_user_step_key_unique");
  });
});
