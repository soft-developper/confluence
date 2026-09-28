ALTER TABLE `relay_requests` ADD `origin_chain_name` text;--> statement-breakpoint
ALTER TABLE `relay_requests` ADD `destination_chain_name` text;--> statement-breakpoint
ALTER TABLE `relay_requests` ADD `decimals_in` integer;--> statement-breakpoint
ALTER TABLE `relay_requests` ADD `decimals_out` integer;