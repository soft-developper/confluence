DROP TABLE `payment_requests`;--> statement-breakpoint
DROP INDEX `transfers_request_id_idx`;--> statement-breakpoint
ALTER TABLE `transfers` DROP COLUMN `request_id`;--> statement-breakpoint
ALTER TABLE `quotes` DROP COLUMN `request_id`;