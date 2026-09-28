CREATE TABLE `relay_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`user_address` text NOT NULL,
	`recipient` text NOT NULL,
	`origin_chain_id` integer NOT NULL,
	`destination_chain_id` integer NOT NULL,
	`origin_currency` text NOT NULL,
	`destination_currency` text NOT NULL,
	`symbol_in` text NOT NULL,
	`symbol_out` text NOT NULL,
	`amount_in` text NOT NULL,
	`amount_out_quoted` text,
	`app_fee_bps` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`in_tx_hash` text,
	`out_tx_hash` text,
	`fail_reason` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `relay_requests_user_idx` ON `relay_requests` (`user_address`);--> statement-breakpoint
CREATE INDEX `relay_requests_status_idx` ON `relay_requests` (`status`);