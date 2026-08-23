CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`request_id` text NOT NULL,
	`mutation_key` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "activity_events_actor_type_check" CHECK("activity_events"."actor_type" IN ('user', 'system:manual-run'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_user_mutation_unique` ON `activity_events` (`user_id`,`mutation_key`);--> statement-breakpoint
CREATE INDEX `activity_events_user_entity_created_index` ON `activity_events` (`user_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `background_effect_dedupes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`step` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`first_run_id` text NOT NULL,
	`status` text NOT NULL,
	`effect_json` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_run_id`) REFERENCES `background_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_run_id`,`user_id`) REFERENCES `background_runs`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "background_effect_dedupes_step_check" CHECK("background_effect_dedupes"."step" IN ('cycle_transition', 'purge', 'outbox_retry')),
	CONSTRAINT "background_effect_dedupes_status_check" CHECK("background_effect_dedupes"."status" IN ('pending', 'succeeded', 'failed')),
	CONSTRAINT "background_effect_dedupes_attempt_count_check" CHECK("background_effect_dedupes"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `background_effect_dedupes_user_step_key_unique` ON `background_effect_dedupes` (`user_id`,`step`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `background_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text NOT NULL,
	`cursor` text,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer,
	`result_json` text,
	`dedupe_key` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_json` text,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `background_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`,`user_id`) REFERENCES `background_runs`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "background_run_steps_step_check" CHECK("background_run_steps"."step" IN ('cycle_transition', 'purge', 'outbox_retry')),
	CONSTRAINT "background_run_steps_status_check" CHECK("background_run_steps"."status" IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "background_run_steps_processed_count_check" CHECK("background_run_steps"."processed_count" >= 0),
	CONSTRAINT "background_run_steps_attempt_count_check" CHECK("background_run_steps"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `background_run_steps_user_status_index` ON `background_run_steps` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `background_run_steps_run_step_unique` ON `background_run_steps` (`run_id`,`step`);--> statement-breakpoint
CREATE TABLE `background_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`plan_json` text NOT NULL,
	`progress_json` text NOT NULL,
	`error_json` text,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`admission_token` text NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`heartbeat_at` integer,
	`finished_at` integer,
	`lease_expires_at` integer,
	`resume_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "background_runs_kind_check" CHECK("background_runs"."kind" = 'maintenance'),
	CONSTRAINT "background_runs_status_check" CHECK("background_runs"."status" IN ('pending', 'running', 'paused', 'failed', 'succeeded', 'rejected')),
	CONSTRAINT "background_runs_resume_count_check" CHECK("background_runs"."resume_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `background_runs_user_idempotency_unique` ON `background_runs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `background_runs_id_user_unique` ON `background_runs` (`id`,`user_id`);--> statement-breakpoint
CREATE TABLE `cycle_issue_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`from_cycle_id` text,
	`to_cycle_id` text,
	`reason` text NOT NULL,
	`moved_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_issue_history_move_unique` ON `cycle_issue_history` (`user_id`,`issue_id`,`from_cycle_id`,`to_cycle_id`,`reason`);--> statement-breakpoint
CREATE TABLE `cycle_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`duration_weeks` integer DEFAULT 2 NOT NULL,
	`cooldown_weeks` integer DEFAULT 0 NOT NULL,
	`start_weekday` integer DEFAULT 1 NOT NULL,
	`future_count` integer DEFAULT 1 NOT NULL,
	`auto_add_to_current_cycle` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cycle_settings_duration_weeks_check" CHECK("cycle_settings"."duration_weeks" BETWEEN 1 AND 8),
	CONSTRAINT "cycle_settings_cooldown_weeks_check" CHECK("cycle_settings"."cooldown_weeks" BETWEEN 0 AND 4),
	CONSTRAINT "cycle_settings_start_weekday_check" CHECK("cycle_settings"."start_weekday" BETWEEN 0 AND 6),
	CONSTRAINT "cycle_settings_future_count_check" CHECK("cycle_settings"."future_count" BETWEEN 1 AND 15)
);
--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`number` integer NOT NULL,
	`name_override` text,
	`description_json` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`schedule_overridden` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	`completion_token` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cycles_status_check" CHECK("cycles"."status" IN ('upcoming', 'active', 'completed')),
	CONSTRAINT "cycles_number_check" CHECK("cycles"."number" >= 0),
	CONSTRAINT "cycles_time_range_check" CHECK("cycles"."ends_at" > "cycles"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycles_user_number_unique` ON `cycles` (`user_id`,`number`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`issue_id`, `label_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_notes_user_issue_created_index` ON `issue_notes` (`user_id`,`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issue_relations` (
	`source_issue_id` text NOT NULL,
	`target_issue_id` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`source_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "issue_relations_type_check" CHECK("issue_relations"."type" IN ('blocking', 'blocked_by', 'related', 'duplicate')),
	CONSTRAINT "issue_relations_not_self_check" CHECK("issue_relations"."source_issue_id" <> "issue_relations"."target_issue_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relations_source_target_type_unique` ON `issue_relations` (`source_issue_id`,`target_issue_id`,`type`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description_json` text,
	`description_text` text DEFAULT '' NOT NULL,
	`status_id` text NOT NULL,
	`priority` text DEFAULT 'no_priority' NOT NULL,
	`estimate` integer,
	`due_at` integer,
	`project_id` text,
	`cycle_id` text,
	`parent_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_mutation_key` text,
	`archived_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `workflow_states`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issues_number_check" CHECK("issues"."number" > 0),
	CONSTRAINT "issues_priority_check" CHECK("issues"."priority" IN ('no_priority', 'low', 'medium', 'high', 'urgent')),
	CONSTRAINT "issues_estimate_check" CHECK("issues"."estimate" IS NULL OR "issues"."estimate" IN (1, 2, 3, 5, 8)),
	CONSTRAINT "issues_version_check" CHECK("issues"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_user_id_number_unique` ON `issues` (`user_id`,`number`);--> statement-breakpoint
CREATE INDEX `issues_user_status_updated_idx` ON `issues` (`user_id`,`status_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `issues_user_cycle_position_idx` ON `issues` (`user_id`,`cycle_id`,`position`);--> statement-breakpoint
CREATE INDEX `issues_user_project_status_position_idx` ON `issues` (`user_id`,`project_id`,`status_id`,`position`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_user_id_name_unique` ON `labels` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`operation` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mutation_receipts_user_key_unique` ON `mutation_receipts` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `notification_type`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`read_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_created_index` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outbox_events_attempt_count_check" CHECK("outbox_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_events_user_dedupe_unique` ON `outbox_events` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbox_events_available_index` ON `outbox_events` (`user_id`,`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `project_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_statuses_category_check" CHECK("project_statuses"."category" IN ('backlog', 'planned', 'in_progress', 'completed', 'canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_statuses_user_id_id_unique` ON `project_statuses` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_statuses_default_user_idx` ON `project_statuses` (`user_id`) WHERE "project_statuses"."is_default" = 1;--> statement-breakpoint
CREATE INDEX `project_statuses_user_position_index` ON `project_statuses` (`user_id`,`position`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status_id` text NOT NULL,
	`priority` text DEFAULT 'no_priority' NOT NULL,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`description_json` text,
	`start_at` integer,
	`start_precision` text,
	`target_at` integer,
	`target_precision` text,
	`archived_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `project_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_priority_check" CHECK("projects"."priority" IN ('no_priority', 'low', 'medium', 'high', 'urgent')),
	CONSTRAINT "projects_start_precision_check" CHECK("projects"."start_precision" IS NULL OR "projects"."start_precision" IN ('day', 'month', 'quarter')),
	CONSTRAINT "projects_target_precision_check" CHECK("projects"."target_precision" IS NULL OR "projects"."target_precision" IN ('day', 'month', 'quarter'))
);
--> statement-breakpoint
CREATE INDEX `projects_user_status_position_index` ON `projects` (`user_id`,`status_id`);--> statement-breakpoint
CREATE TABLE `recent_issue_views` (
	`user_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `issue_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recent_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`normalized_query_json` text NOT NULL,
	`searched_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recent_searches_user_query_unique` ON `recent_searches` (`user_id`,`normalized_query_json`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`entity_type` text NOT NULL,
	`query_json` text NOT NULL,
	`layout_json` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_views_user_deleted_index` ON `saved_views` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text NOT NULL,
	`locale` text DEFAULT 'ja' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`issue_counter` integer DEFAULT 0 NOT NULL,
	`estimate_enabled` integer DEFAULT true NOT NULL,
	`default_issue_display_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_preferences_locale_check" CHECK("user_preferences"."locale" IN ('ja', 'en')),
	CONSTRAINT "user_preferences_theme_check" CHECK("user_preferences"."theme" IN ('light', 'dark', 'system')),
	CONSTRAINT "user_preferences_issue_counter_check" CHECK("user_preferences"."issue_counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE `user_runtime_locks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`lock_token` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`acquired_at` integer,
	`heartbeat_at` integer,
	`lease_expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `background_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_runtime_locks_status_check" CHECK("user_runtime_locks"."status" IN ('idle', 'running'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`avatar_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workflow_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_states_category_check" CHECK("workflow_states"."category" IN ('backlog', 'unstarted', 'started', 'completed', 'canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_states_user_id_id_unique` ON `workflow_states` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_states_default_user_idx` ON `workflow_states` (`user_id`) WHERE "workflow_states"."is_default" = 1;--> statement-breakpoint
CREATE INDEX `workflow_states_user_position_index` ON `workflow_states` (`user_id`,`position`);