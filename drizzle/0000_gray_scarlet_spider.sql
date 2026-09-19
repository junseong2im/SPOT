CREATE TABLE `crews` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`invite` text NOT NULL,
	`owner` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crews_invite_unique` ON `crews` (`invite`);--> statement-breakpoint
CREATE TABLE `members` (
	`crew_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`crew_id`, `user_id`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `personal` (
	`crew_id` text NOT NULL,
	`user_id` text NOT NULL,
	`routine_id` text NOT NULL,
	`content` text NOT NULL,
	`base_version` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`crew_id`, `user_id`, `routine_id`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action
);
