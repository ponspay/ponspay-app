ALTER TABLE `launch_links` ADD `name` text;--> statement-breakpoint
ALTER TABLE `launch_links` ADD `symbol` text;--> statement-breakpoint
ALTER TABLE `launch_links` ADD `logo_url` text;--> statement-breakpoint
ALTER TABLE `launch_links` ADD `description` text;--> statement-breakpoint
ALTER TABLE `launch_links` ADD `launcher_address` text;--> statement-breakpoint
ALTER TABLE `launch_links` ADD `status` text DEFAULT 'live' NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
