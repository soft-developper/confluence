CREATE TABLE `payment_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`payee_id` text,
	`destination_chain` text NOT NULL,
	`amount_base` text NOT NULL,
	`memo` text,
	`expires_at` integer NOT NULL,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`creator`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_requests_creator_idx` ON `payment_requests` (`creator`);--> statement-breakpoint
ALTER TABLE `quotes` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `request_id` text;--> statement-breakpoint
CREATE INDEX `transfers_request_id_idx` ON `transfers` (`request_id`);