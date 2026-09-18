CREATE TABLE `creator_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`normalized_handle` text NOT NULL,
	`platform_user_id` text,
	`display_name` text,
	`avatar_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`vault_key` text NOT NULL,
	`vault_address` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`verified_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creator_routes_platform_handle` ON `creator_routes` (`platform`,`normalized_handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creator_routes_vault_key` ON `creator_routes` (`vault_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creator_routes_platform_user` ON `creator_routes` (`platform`,`platform_user_id`);--> statement-breakpoint
CREATE TABLE `creator_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `creator_routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creator_sessions_token_hash` ON `creator_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `fee_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_link_id` text NOT NULL,
	`chain_id` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`asset_address` text NOT NULL,
	`amount_raw` text NOT NULL,
	`onchain_lot_id` text,
	`claim_deadline` text NOT NULL,
	`status` text DEFAULT 'claimable' NOT NULL,
	`payout_tx_hash` text,
	`burn_tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`launch_link_id`) REFERENCES `launch_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fee_batches_event` ON `fee_batches` (`chain_id`,`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `idx_fee_batches_launch_status` ON `fee_batches` (`launch_link_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_fee_batches_deadline_status` ON `fee_batches` (`claim_deadline`,`status`);--> statement-breakpoint
CREATE TABLE `launch_links` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` integer NOT NULL,
	`token_address` text NOT NULL,
	`route_id` text NOT NULL,
	`creator_fee_bps` integer DEFAULT 400 NOT NULL,
	`creator_share_bps` integer DEFAULT 8000 NOT NULL,
	`burn_share_bps` integer DEFAULT 2000 NOT NULL,
	`launch_tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `creator_routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_links_chain_token` ON `launch_links` (`chain_id`,`token_address`);--> statement-breakpoint
CREATE INDEX `idx_launch_links_route` ON `launch_links` (`route_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`code_verifier` text NOT NULL,
	`return_to` text DEFAULT '/' NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `withdrawal_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`asset_address` text NOT NULL,
	`amount_raw` text NOT NULL,
	`recipient_address` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`route_id`) REFERENCES `creator_routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_withdrawal_requests_route_status` ON `withdrawal_requests` (`route_id`,`status`);
--> statement-breakpoint
PRAGMA optimize;
