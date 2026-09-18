CREATE TABLE `launch_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `route_id` text NOT NULL,
  `chain_id` integer NOT NULL,
  `launch_key` text NOT NULL,
  `vault_address` text,
  `vault_tx_hash` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at` text NOT NULL,
  `finalized_at` text,
  FOREIGN KEY (`route_id`) REFERENCES `creator_routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_intents_launch_key` ON `launch_intents` (`launch_key`);
--> statement-breakpoint
CREATE INDEX `idx_launch_intents_status` ON `launch_intents` (`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_launch_intents_route` ON `launch_intents` (`route_id`);
--> statement-breakpoint
ALTER TABLE `launch_links` ADD `launch_intent_id` text;
--> statement-breakpoint
ALTER TABLE `launch_links` ADD `vault_key` text;
--> statement-breakpoint
ALTER TABLE `launch_links` ADD `vault_address` text;
--> statement-breakpoint
ALTER TABLE `launch_links` ADD `vault_tx_hash` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_links_intent` ON `launch_links` (`launch_intent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_links_vault_key` ON `launch_links` (`vault_key`);
--> statement-breakpoint
ALTER TABLE `withdrawal_requests` ADD `launch_link_id` text;
