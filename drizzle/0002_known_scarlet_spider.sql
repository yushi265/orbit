PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text NOT NULL,
	`locale` text DEFAULT 'ja' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`color_theme` text DEFAULT 'coral' NOT NULL,
	`issue_counter` integer DEFAULT 0 NOT NULL,
	`estimate_enabled` integer DEFAULT true NOT NULL,
	`default_issue_display_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_preferences_locale_check" CHECK("__new_user_preferences"."locale" IN ('ja', 'en')),
	CONSTRAINT "user_preferences_theme_check" CHECK("__new_user_preferences"."theme" IN ('light', 'dark', 'system')),
	CONSTRAINT "user_preferences_color_theme_check" CHECK("__new_user_preferences"."color_theme" IN ('coral', 'ocean', 'violet', 'forest', 'amber')),
	CONSTRAINT "user_preferences_issue_counter_check" CHECK("__new_user_preferences"."issue_counter" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "timezone", "locale", "theme", "color_theme", "issue_counter", "estimate_enabled", "default_issue_display_json") SELECT "user_id", "timezone", "locale", "theme", 'coral', "issue_counter", "estimate_enabled", "default_issue_display_json" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
