ALTER TABLE `swaps` ADD `verified_at` integer;--> statement-breakpoint
CREATE INDEX `swaps_state_verified_idx` ON `swaps` (`state`,`verified_at`);