CREATE TABLE `arc_payment_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`source` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `arc_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `arc_payment_events_payment_idx` ON `arc_payment_events` (`payment_id`);--> statement-breakpoint
CREATE TABLE `arc_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'CREATED' NOT NULL,
	`chain` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`recipient_id` text NOT NULL,
	`amount_base` text NOT NULL,
	`fee_base` text NOT NULL,
	`fee_recipient` text NOT NULL,
	`note` text,
	`fee_tx_hash` text,
	`pay_tx_hash` text,
	`fee_verified_at` integer,
	`pay_verified_at` integer,
	`error_code` text,
	`report_token_hash` text,
	`tracked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arc_payments_idempotency_key_uq` ON `arc_payments` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `arc_payments_fee_tx_hash_uq` ON `arc_payments` (`fee_tx_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `arc_payments_pay_tx_hash_uq` ON `arc_payments` (`pay_tx_hash`);--> statement-breakpoint
CREATE INDEX `arc_payments_state_idx` ON `arc_payments` (`state`);--> statement-breakpoint
CREATE INDEX `arc_payments_sender_lower_idx` ON `arc_payments` (lower("sender"));--> statement-breakpoint
CREATE INDEX `arc_payments_recipient_lower_idx` ON `arc_payments` (lower("recipient"));