CREATE INDEX `admin_reset_tokens_expires_idx` ON `admin_reset_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_nonces_expires_idx` ON `auth_nonces` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `swaps_sender_lower_idx` ON `swaps` (lower("sender"));--> statement-breakpoint
CREATE INDEX `transfers_sender_lower_idx` ON `transfers` (lower("sender"));--> statement-breakpoint
CREATE INDEX `transfers_recipient_lower_idx` ON `transfers` (lower("recipient"));