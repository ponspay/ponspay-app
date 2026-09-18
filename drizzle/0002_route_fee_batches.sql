CREATE TABLE `fee_batches_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `route_id` text NOT NULL,
  `launch_link_id` text,
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
  FOREIGN KEY (`route_id`) REFERENCES `creator_routes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`launch_link_id`) REFERENCES `launch_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `fee_batches_v2` (`id`,`route_id`,`launch_link_id`,`chain_id`,`tx_hash`,`log_index`,`asset_address`,`amount_raw`,`onchain_lot_id`,`claim_deadline`,`status`,`payout_tx_hash`,`burn_tx_hash`,`created_at`,`settled_at`)
SELECT f.id,l.route_id,f.launch_link_id,f.chain_id,f.tx_hash,f.log_index,f.asset_address,f.amount_raw,f.onchain_lot_id,f.claim_deadline,f.status,f.payout_tx_hash,f.burn_tx_hash,f.created_at,f.settled_at
FROM `fee_batches` f JOIN `launch_links` l ON l.id=f.launch_link_id;
--> statement-breakpoint
DROP TABLE `fee_batches`;
--> statement-breakpoint
ALTER TABLE `fee_batches_v2` RENAME TO `fee_batches`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fee_batches_event` ON `fee_batches` (`chain_id`,`tx_hash`,`log_index`);
--> statement-breakpoint
CREATE INDEX `idx_fee_batches_route_status` ON `fee_batches` (`route_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_fee_batches_launch_status` ON `fee_batches` (`launch_link_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_fee_batches_deadline_status` ON `fee_batches` (`claim_deadline`,`status`);
