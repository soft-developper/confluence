ALTER TABLE `transfers` ADD `tracked_at` integer;--> statement-breakpoint
CREATE INDEX `transfers_tracked_at_idx` ON `transfers` (`tracked_at`);