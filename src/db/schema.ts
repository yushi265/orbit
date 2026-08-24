import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull(),
    locale: text("locale").notNull().default("ja"),
    theme: text("theme").notNull().default("system"),
    issueCounter: integer("issue_counter", { mode: "number" }).notNull().default(0),
    estimateEnabled: integer("estimate_enabled", { mode: "boolean" }).notNull().default(true),
    defaultIssueDisplayJson: text("default_issue_display_json").notNull().default("{}"),
  },
  (table) => [
    check("user_preferences_locale_check", sql`${table.locale} IN ('ja', 'en')`),
    check("user_preferences_theme_check", sql`${table.theme} IN ('light', 'dark', 'system')`),
    check("user_preferences_issue_counter_check", sql`${table.issueCounter} >= 0`),
  ],
);

export const workflowStates = sqliteTable(
  "workflow_states",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    color: text("color").notNull(),
    position: integer("position", { mode: "number" }).notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("workflow_states_user_id_id_unique").on(table.id, table.userId),
    uniqueIndex("workflow_states_default_user_idx")
      .on(table.userId)
      .where(sql`${table.isDefault} = 1`),
    index("workflow_states_user_position_index").on(table.userId, table.position),
    check(
      "workflow_states_category_check",
      sql`${table.category} IN ('backlog', 'unstarted', 'started', 'completed', 'canceled')`,
    ),
  ],
);

export const cycleSettings = sqliteTable(
  "cycle_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    durationWeeks: integer("duration_weeks", { mode: "number" }).notNull().default(2),
    cooldownWeeks: integer("cooldown_weeks", { mode: "number" }).notNull().default(0),
    startWeekday: integer("start_weekday", { mode: "number" }).notNull().default(1),
    futureCount: integer("future_count", { mode: "number" }).notNull().default(1),
    autoAddToCurrentCycle: integer("auto_add_to_current_cycle", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    check("cycle_settings_duration_weeks_check", sql`${table.durationWeeks} BETWEEN 1 AND 8`),
    check("cycle_settings_cooldown_weeks_check", sql`${table.cooldownWeeks} BETWEEN 0 AND 4`),
    check("cycle_settings_start_weekday_check", sql`${table.startWeekday} BETWEEN 0 AND 6`),
    check("cycle_settings_future_count_check", sql`${table.futureCount} BETWEEN 1 AND 15`),
  ],
);

export const cycles = sqliteTable(
  "cycles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    number: integer("number", { mode: "number" }).notNull(),
    nameOverride: text("name_override"),
    descriptionJson: text("description_json"),
    startsAt: integer("starts_at", { mode: "number" }).notNull(),
    endsAt: integer("ends_at", { mode: "number" }).notNull(),
    scheduleOverridden: integer("schedule_overridden", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status").notNull(),
    completedAt: integer("completed_at", { mode: "number" }),
    completionToken: text("completion_token"),
  },
  (table) => [
    uniqueIndex("cycles_user_number_unique").on(table.userId, table.number),
    check("cycles_status_check", sql`${table.status} IN ('upcoming', 'active', 'completed')`),
    check("cycles_number_check", sql`${table.number} >= 0`),
    check("cycles_time_range_check", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const projectStatuses = sqliteTable(
  "project_statuses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    color: text("color").notNull(),
    position: integer("position", { mode: "number" }).notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("project_statuses_user_id_id_unique").on(table.id, table.userId),
    uniqueIndex("project_statuses_default_user_idx")
      .on(table.userId)
      .where(sql`${table.isDefault} = 1`),
    index("project_statuses_user_position_index").on(table.userId, table.position),
    check(
      "project_statuses_category_check",
      sql`${table.category} IN ('backlog', 'planned', 'in_progress', 'completed', 'canceled')`,
    ),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    statusId: text("status_id")
      .notNull()
      .references(() => projectStatuses.id),
    priority: text("priority").notNull().default("no_priority"),
    color: text("color").notNull(),
    icon: text("icon").notNull(),
    descriptionJson: text("description_json"),
    startAt: integer("start_at", { mode: "number" }),
    startPrecision: text("start_precision"),
    targetAt: integer("target_at", { mode: "number" }),
    targetPrecision: text("target_precision"),
    archivedAt: integer("archived_at", { mode: "number" }),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (table) => [
    index("projects_user_status_position_index").on(table.userId, table.statusId),
    check(
      "projects_priority_check",
      sql`${table.priority} IN ('no_priority', 'low', 'medium', 'high', 'urgent')`,
    ),
    check(
      "projects_start_precision_check",
      sql`${table.startPrecision} IS NULL OR ${table.startPrecision} IN ('day', 'month', 'quarter')`,
    ),
    check(
      "projects_target_precision_check",
      sql`${table.targetPrecision} IS NULL OR ${table.targetPrecision} IN ('day', 'month', 'quarter')`,
    ),
  ],
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    number: integer("number", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    descriptionJson: text("description_json"),
    descriptionText: text("description_text").notNull().default(""),
    statusId: text("status_id")
      .notNull()
      .references(() => workflowStates.id),
    priority: text("priority").notNull().default("no_priority"),
    estimate: integer("estimate", { mode: "number" }),
    dueAt: integer("due_at", { mode: "number" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    cycleId: text("cycle_id").references(() => cycles.id, { onDelete: "set null" }),
    parentId: text("parent_id"),
    position: integer("position", { mode: "number" }).notNull().default(0),
    version: integer("version", { mode: "number" }).notNull().default(1),
    lastMutationKey: text("last_mutation_key"),
    archivedAt: integer("archived_at", { mode: "number" }),
    deletedAt: integer("deleted_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "issues_parent_id_fk",
    }),
    uniqueIndex("issues_user_id_number_unique").on(table.userId, table.number),
    index("issues_user_status_updated_idx").on(table.userId, table.statusId, table.updatedAt),
    index("issues_user_cycle_position_idx").on(table.userId, table.cycleId, table.position),
    index("issues_user_project_status_position_idx").on(
      table.userId,
      table.projectId,
      table.statusId,
      table.position,
    ),
    check("issues_number_check", sql`${table.number} > 0`),
    check(
      "issues_priority_check",
      sql`${table.priority} IN ('no_priority', 'low', 'medium', 'high', 'urgent')`,
    ),
    check(
      "issues_estimate_check",
      sql`${table.estimate} IS NULL OR ${table.estimate} IN (1, 2, 3, 5, 8)`,
    ),
    check("issues_version_check", sql`${table.version} >= 1`),
  ],
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (table) => [uniqueIndex("labels_user_id_name_unique").on(table.userId, table.name)],
);

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.issueId, table.labelId] })],
);

export const issueRelations = sqliteTable(
  "issue_relations",
  {
    sourceIssueId: text("source_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    targetIssueId: text("target_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
  },
  (table) => [
    uniqueIndex("issue_relations_source_target_type_unique").on(
      table.sourceIssueId,
      table.targetIssueId,
      table.type,
    ),
    check(
      "issue_relations_type_check",
      sql`${table.type} IN ('blocking', 'blocked_by', 'related', 'duplicate')`,
    ),
    check("issue_relations_not_self_check", sql`${table.sourceIssueId} <> ${table.targetIssueId}`),
  ],
);

export const issueNotes = sqliteTable(
  "issue_notes",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bodyJson: text("body_json").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    editedAt: integer("edited_at", { mode: "number" }),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (table) => [
    index("issue_notes_user_issue_created_index").on(table.userId, table.issueId, table.createdAt),
  ],
);

export const cycleIssueHistory = sqliteTable(
  "cycle_issue_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    fromCycleId: text("from_cycle_id").references(() => cycles.id, {
      onDelete: "set null",
    }),
    toCycleId: text("to_cycle_id").references(() => cycles.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    movedAt: integer("moved_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("cycle_issue_history_move_unique").on(
      table.userId,
      table.issueId,
      table.fromCycleId,
      table.toCycleId,
      table.reason,
    ),
  ],
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull(),
    queryJson: text("query_json").notNull(),
    layoutJson: text("layout_json").notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (table) => [index("saved_views_user_deleted_index").on(table.userId, table.deletedAt)],
);

export const recentIssueViews = sqliteTable(
  "recent_issue_views",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    viewedAt: integer("viewed_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.issueId] })],
);

export const recentSearches = sqliteTable(
  "recent_searches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    normalizedQueryJson: text("normalized_query_json").notNull(),
    searchedAt: integer("searched_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("recent_searches_user_query_unique").on(table.userId, table.normalizedQueryJson),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    readAt: integer("read_at", { mode: "number" }),
    deletedAt: integer("deleted_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("notifications_user_read_created_index").on(table.userId, table.readAt, table.createdAt),
  ],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.userId, table.notificationType] })],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    requestId: text("request_id").notNull(),
    mutationKey: text("mutation_key").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("activity_events_user_mutation_unique").on(table.userId, table.mutationKey),
    index("activity_events_user_entity_created_index").on(
      table.userId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    check(
      "activity_events_actor_type_check",
      sql`${table.actorType} IN ('user', 'system:manual-run')`,
    ),
  ],
);

export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count", { mode: "number" }).notNull().default(0),
    availableAt: integer("available_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("outbox_events_user_dedupe_unique").on(table.userId, table.dedupeKey),
    index("outbox_events_available_index").on(table.userId, table.status, table.availableAt),
    check("outbox_events_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const mutationReceipts = sqliteTable(
  "mutation_receipts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("mutation_receipts_user_key_unique").on(table.userId, table.idempotencyKey),
  ],
);

export const backgroundRuns = sqliteTable(
  "background_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    planJson: text("plan_json").notNull(),
    progressJson: text("progress_json").notNull(),
    errorJson: text("error_json"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    admissionToken: text("admission_token").notNull(),
    requestedAt: integer("requested_at", { mode: "number" }).notNull(),
    startedAt: integer("started_at", { mode: "number" }),
    heartbeatAt: integer("heartbeat_at", { mode: "number" }),
    finishedAt: integer("finished_at", { mode: "number" }),
    leaseExpiresAt: integer("lease_expires_at", { mode: "number" }),
    resumeCount: integer("resume_count", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    uniqueIndex("background_runs_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    uniqueIndex("background_runs_id_user_unique").on(table.id, table.userId),
    check("background_runs_kind_check", sql`${table.kind} = 'maintenance'`),
    check(
      "background_runs_status_check",
      sql`${table.status} IN ('pending', 'running', 'paused', 'failed', 'succeeded', 'rejected')`,
    ),
    check("background_runs_resume_count_check", sql`${table.resumeCount} >= 0`),
  ],
);

export const backgroundRunSteps = sqliteTable(
  "background_run_steps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => backgroundRuns.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    status: text("status").notNull(),
    cursor: text("cursor"),
    processedCount: integer("processed_count", { mode: "number" }).notNull().default(0),
    totalCount: integer("total_count", { mode: "number" }),
    resultJson: text("result_json"),
    dedupeKey: text("dedupe_key").notNull(),
    attemptCount: integer("attempt_count", { mode: "number" }).notNull().default(0),
    errorJson: text("error_json"),
    startedAt: integer("started_at", { mode: "number" }),
    finishedAt: integer("finished_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("background_run_steps_run_step_unique").on(table.runId, table.step),
    index("background_run_steps_user_status_index").on(table.userId, table.status),
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [backgroundRuns.id, backgroundRuns.userId],
      name: "background_run_steps_run_owner_fk",
    }),
    check(
      "background_run_steps_step_check",
      sql`${table.step} IN ('cycle_transition', 'purge', 'outbox_retry')`,
    ),
    check(
      "background_run_steps_status_check",
      sql`${table.status} IN ('pending', 'running', 'succeeded', 'failed', 'skipped')`,
    ),
    check("background_run_steps_processed_count_check", sql`${table.processedCount} >= 0`),
    check("background_run_steps_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const backgroundEffectDedupes = sqliteTable(
  "background_effect_dedupes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    firstRunId: text("first_run_id")
      .notNull()
      .references(() => backgroundRuns.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    effectJson: text("effect_json"),
    attemptCount: integer("attempt_count", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    completedAt: integer("completed_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("background_effect_dedupes_user_step_key_unique").on(
      table.userId,
      table.step,
      table.dedupeKey,
    ),
    foreignKey({
      columns: [table.firstRunId, table.userId],
      foreignColumns: [backgroundRuns.id, backgroundRuns.userId],
      name: "background_effect_dedupes_run_owner_fk",
    }),
    check(
      "background_effect_dedupes_step_check",
      sql`${table.step} IN ('cycle_transition', 'purge', 'outbox_retry')`,
    ),
    check(
      "background_effect_dedupes_status_check",
      sql`${table.status} IN ('pending', 'succeeded', 'failed')`,
    ),
    check("background_effect_dedupes_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const userRuntimeLocks = sqliteTable(
  "user_runtime_locks",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => backgroundRuns.id, {
      onDelete: "set null",
    }),
    lockToken: text("lock_token"),
    status: text("status").notNull().default("idle"),
    acquiredAt: integer("acquired_at", { mode: "number" }),
    heartbeatAt: integer("heartbeat_at", { mode: "number" }),
    leaseExpiresAt: integer("lease_expires_at", { mode: "number" }),
  },
  (table) => [
    check("user_runtime_locks_status_check", sql`${table.status} IN ('idle', 'running')`),
  ],
);

export const orbitStoreSnapshots = sqliteTable(
  "orbit_store_snapshots",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version", { mode: "number" }).notNull().default(0),
    stateJson: text("state_json").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [check("orbit_store_snapshots_version_check", sql`${table.version} >= 0`)],
);

export const schema = {
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
};

export type Schema = typeof schema;
