CREATE TABLE `claim_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `route_id` text NOT NULL,
  `launch_link_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `tx_hash` text,
  `error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `settled_at` text,
  FOREIGN KEY (`route_id`) REFERENCES `creator_routes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`launch_link_id`) REFERENCES `launch_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_claim_requests_status` ON `claim_requests` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_claim_requests_route` ON `claim_requests` (`route_id`,`status`);
