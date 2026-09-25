CREATE TABLE `accounts` (
	`address` text PRIMARY KEY NOT NULL,
	`confluence_id` text,
	`id_claimed_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_confluence_id_uq` ON `accounts` (`confluence_id`);--> statement-breakpoint
CREATE TABLE `address_book_entries` (
	`owner` text NOT NULL,
	`address` text NOT NULL,
	`id` text NOT NULL,
	`display_address` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `address_book_owner_address_uq` ON `address_book_entries` (`owner`,`address`);--> statement-breakpoint
CREATE TABLE `auth_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`address` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`address`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_address_idx` ON `sessions` (`address`);