CREATE TABLE `saved_ids` (
	`owner` text NOT NULL,
	`handle` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`owner`, `handle`)
);
--> statement-breakpoint
ALTER TABLE `quotes` ADD `note` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `note` text;