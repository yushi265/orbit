PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity_events` (
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
	CONSTRAINT "activity_events_actor_type_check" CHECK("__new_activity_events"."actor_type" IN ('user', 'system:manual-run', 'system:automation'))
);
--> statement-breakpoint
INSERT INTO `__new_activity_events`("id", "user_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "request_id", "mutation_key", "before_json", "after_json", "created_at") SELECT "id", "user_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "request_id", "mutation_key", "before_json", "after_json", "created_at" FROM `activity_events`;--> statement-breakpoint
DROP TABLE `activity_events`;--> statement-breakpoint
ALTER TABLE `__new_activity_events` RENAME TO `activity_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_user_mutation_unique` ON `activity_events` (`user_id`,`mutation_key`);--> statement-breakpoint
CREATE INDEX `activity_events_user_entity_created_index` ON `activity_events` (`user_id`,`entity_type`,`entity_id`,`created_at`);