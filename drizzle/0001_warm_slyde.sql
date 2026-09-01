CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`login` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`participates_in_queue` integer DEFAULT true NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `support_agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_agent_id_unique` ON `app_users` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_login` ON `app_users` (`login`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_token` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expiry` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `fixed_queue_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor_position` integer DEFAULT 0 NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`next_agent_id` text,
	`started_at` text NOT NULL,
	FOREIGN KEY (`next_agent_id`) REFERENCES `support_agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `queue_presence` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `support_agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_queue_presence_seen` ON `queue_presence` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `turn_acknowledgements` (
	`user_id` text NOT NULL,
	`turn_sequence` integer NOT NULL,
	`acknowledged_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `turn_sequence`),
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`details` text,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_user_audit_user_time` ON `user_audit_log` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `user_presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
