CREATE TABLE `deployments` (
	`room` text NOT NULL,
	`name` text NOT NULL,
	`record` text NOT NULL,
	PRIMARY KEY(`room`, `name`)
);
