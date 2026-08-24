CREATE TABLE `orbit_store_snapshots` (
	`user_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orbit_store_snapshots_version_check" CHECK("orbit_store_snapshots"."version" >= 0)
);
