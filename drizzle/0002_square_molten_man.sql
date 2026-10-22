ALTER TABLE `events` ADD `actor_user_id` text REFERENCES app_users(id);--> statement-breakpoint
ALTER TABLE `events` ADD `actor_name` text;--> statement-breakpoint
CREATE INDEX `idx_events_actor_time` ON `events` (`actor_user_id`,`occurred_at`);