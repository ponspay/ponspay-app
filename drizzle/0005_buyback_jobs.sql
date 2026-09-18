CREATE TABLE `buyback_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `amount_raw` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `tx_hash` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `settled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_buyback_jobs_source` ON `buyback_jobs` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_buyback_jobs_status` ON `buyback_jobs` (`status`,`created_at`);
