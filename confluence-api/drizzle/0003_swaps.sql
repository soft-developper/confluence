CREATE TABLE `swap_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`swap_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`source` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`swap_id`) REFERENCES `swaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `swap_events_swap_idx` ON `swap_events` (`swap_id`);--> statement-breakpoint
CREATE TABLE `swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text NOT NULL,
	`chain` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`token_in` text NOT NULL,
	`token_out` text NOT NULL,
	`amount_in` text NOT NULL,
	`fee_recipient` text NOT NULL,
	`fee_side` text,
	`fee_token` text,
	`fee_expected` text,
	`fee_charged` text,
	`estimated_out` text,
	`min_out` text,
	`amount_out` text,
	`approval_tx_hash` text,
	`swap_tx_hash` text,
	`error_code` text,
	`report_token_hash` text,
	`tracked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `swaps_idempotency_key_uq` ON `swaps` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `swaps_swap_tx_hash_uq` ON `swaps` (`swap_tx_hash`);--> statement-breakpoint
CREATE INDEX `swaps_sender_idx` ON `swaps` (`sender`);--> statement-breakpoint
CREATE INDEX `swaps_state_idx` ON `swaps` (`state`);