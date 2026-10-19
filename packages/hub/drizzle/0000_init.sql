CREATE TABLE `log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text,
	`at` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`room` text NOT NULL,
	`handle` text NOT NULL,
	`description` text NOT NULL,
	`pane_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`status` text NOT NULL,
	`terminal_id` text,
	`agent` text,
	`reason` text,
	`held` text,
	`instructions` text,
	PRIMARY KEY(`room`, `handle`),
	CONSTRAINT "members_handle" CHECK("members"."handle" GLOB '[a-z0-9]*' AND "members"."handle" NOT GLOB '*[^a-z0-9_-]*'),
	CONSTRAINT "members_status" CHECK("members"."status" IN ('pending', 'active', 'gone', 'left', 'rejected')),
	CONSTRAINT "members_active_bound" CHECK("members"."status" <> 'active' OR ("members"."terminal_id" IS NOT NULL AND "members"."agent" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_one_per_pane` ON `members` (`room`,`pane_id`) WHERE "members"."status" IN ('pending', 'active');--> statement-breakpoint
CREATE TABLE `queue` (
	`room` text NOT NULL,
	`recipient` text NOT NULL,
	`message_id` integer NOT NULL,
	`sender` text NOT NULL,
	`kind` text NOT NULL,
	`re` integer,
	`text` text NOT NULL,
	`unsure` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`room`, `recipient`, `message_id`),
	CONSTRAINT "queue_text" CHECK(length("queue"."text") BETWEEN 1 AND 16000),
	CONSTRAINT "queue_kind" CHECK("queue"."kind" IN ('message', 'fyi', 'joined', 'left', 'undelivered')),
	CONSTRAINT "queue_unsure" CHECK("queue"."unsure" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `service` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text,
	`heartbeat` integer DEFAULT 0 NOT NULL,
	`closed` integer DEFAULT true NOT NULL,
	`dirty` integer DEFAULT false NOT NULL,
	`last_message_id` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_single_row" CHECK("service"."id" = 1),
	CONSTRAINT "service_closed" CHECK("service"."closed" IN (0, 1)),
	CONSTRAINT "service_dirty" CHECK("service"."dirty" IN (0, 1))
);
