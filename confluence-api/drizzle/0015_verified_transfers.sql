ALTER TABLE `transfers` ADD `verified_at` integer;--> statement-breakpoint
CREATE INDEX `transfers_state_verified_idx` ON `transfers` (`state`,`verified_at`);--> statement-breakpoint
UPDATE `transfers` SET `verified_at` = (SELECT min(e.`created_at`) FROM `transfer_events` e WHERE e.`transfer_id` = `transfers`.`id` AND e.`source` = 'worker' AND (e.`to_state` IN ('ATTESTED', 'COMPLETED') OR (e.`to_state` = 'RECOVERY_REQUIRED' AND `transfers`.`error_code` = 'forward_failed'))) WHERE `verified_at` IS NULL;
