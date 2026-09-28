ALTER TABLE `relay_requests` ADD `app_fee_quoted_usd` text;--> statement-breakpoint
ALTER TABLE `relay_requests` ADD `amount_in_usd` text;--> statement-breakpoint
ALTER TABLE `relay_requests` ADD `app_fee_paid_usd` text;--> statement-breakpoint
ALTER TABLE `relay_requests` ADD `enriched_at` integer;