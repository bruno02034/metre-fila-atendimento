CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`secondary_agent_id` text,
	`ticket_id` text,
	`action` text NOT NULL,
	`details` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`business_date` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `support_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`secondary_agent_id`) REFERENCES `support_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_business_date_time` ON `events` (`business_date`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_events_agent_date` ON `events` (`agent_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `queue_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`lock_token` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`queue_position` integer NOT NULL,
	`initial_position` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_support_agents_name` ON `support_agents` (`name`);--> statement-breakpoint
CREATE INDEX `idx_support_agents_active_queue` ON `support_agents` (`is_active`,`queue_position`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`client` text,
	`owner_agent_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`business_date` text NOT NULL,
	`started_at` text NOT NULL,
	`closed_at` text,
	`duration_seconds` integer,
	FOREIGN KEY (`owner_agent_id`) REFERENCES `support_agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tickets_owner_status` ON `tickets` (`owner_agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tickets_business_date` ON `tickets` (`business_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tickets_external_open` ON `tickets` (`external_id`) WHERE "tickets"."external_id" IS NOT NULL AND "tickets"."status" = 'open';