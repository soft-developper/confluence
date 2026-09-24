CREATE TABLE `fee_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chain` text NOT NULL,
	`address` text NOT NULL,
	`effective_from` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fee_recipients_chain_from_uq` ON `fee_recipients` (`chain`,`effective_from`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expires_idx` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`source_chain` text NOT NULL,
	`destination_chain` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`amount_base` text NOT NULL,
	`platform_fee_base` text NOT NULL,
	`cctp_fee_base` text NOT NULL,
	`forwarding_fee_base` text NOT NULL,
	`speed` text NOT NULL,
	`use_forwarder` integer NOT NULL,
	`fee_recipient` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quotes_sender_idx` ON `quotes` (`sender`);--> statement-breakpoint
CREATE TABLE `transfer_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transfer_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`source` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transfer_events_transfer_idx` ON `transfer_events` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'CREATED' NOT NULL,
	`source_chain` text NOT NULL,
	`destination_chain` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`amount_base` text NOT NULL,
	`platform_fee_base` text NOT NULL,
	`speed` text NOT NULL,
	`use_forwarder` integer NOT NULL,
	`burn_tx_hash` text,
	`mint_tx_hash` text,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_idempotency_key_uq` ON `transfers` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_burn_tx_hash_uq` ON `transfers` (`burn_tx_hash`);--> statement-breakpoint
CREATE INDEX `transfers_state_idx` ON `transfers` (`state`);--> statement-breakpoint
CREATE INDEX `transfers_sender_idx` ON `transfers` (`sender`);