ALTER TABLE `transfers` ADD `report_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_quote_id_uq` ON `transfers` (`quote_id`);