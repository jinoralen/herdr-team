// The database's tables, for Drizzle. `bun run db:generate` turns changes here into a migration
// under drizzle/, which store.ts applies when it opens the database.
// CHECK constraints keep invalid rows out, so readers can trust what they get back.

import { type SQL, sql } from 'drizzle-orm';
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { MAX_MESSAGE_CHARS } from './constraints.ts';

const MEMBER_STATUSES = ['pending', 'active', 'gone', 'left', 'rejected'] as const;
const QUEUE_KINDS = ['message', 'fyi', 'joined', 'left', 'undelivered'] as const;

// SQL text for `column IN ('a', 'b')`, from the same list that types the column.
const oneOf = (values: readonly string[]): SQL => sql.raw(values.map((v) => `'${v}'`).join(', '));

// One tick at a time serves every room; this single row is its lock and heartbeat.
// owner is a per-tick token, so a tick that lost the lock notices instead of carrying on.
// heartbeat > 0 also shows that herdr-agent-hub has run here at all (the Herdr plugin is installed).
// dirty: a tick was requested while another held the lock; the holder runs once more before releasing.
// last_message_id: the id of the newest message (m1, m2, … across all rooms), so ids are never reused.
export const service = sqliteTable(
  'service',
  {
    id: integer().primaryKey(),
    owner: text(),
    heartbeat: integer().notNull().default(0),
    closed: integer({ mode: 'boolean' }).notNull().default(true),
    dirty: integer({ mode: 'boolean' }).notNull().default(false),
    last_message_id: integer().notNull().default(0),
  },
  (t) => [
    check('service_single_row', sql`${t.id} = 1`),
    check('service_closed', sql`${t.closed} IN (0, 1)`),
    check('service_dirty', sql`${t.dirty} IN (0, 1)`),
  ],
);

// A room is a Herdr workspace; its ID is the room column here and in queue and log.
// pane_id: the pane the agent joined from (HERDR_PANE_ID in its environment, fixed for its life);
// it identifies commands from the pane. terminal_id follows pane moves; agent records its kind
// at admission for display, and does not restrict delivery.
// held: why its messages wait, as last logged, so each reason is logged once across ticks.
export const members = sqliteTable(
  'members',
  {
    room: text().notNull(),
    handle: text().notNull(),
    description: text().notNull(),
    pane_id: text().notNull(),
    joined_at: text().notNull(),
    status: text({ enum: MEMBER_STATUSES }).notNull(),
    terminal_id: text(),
    agent: text(),
    reason: text(),
    held: text(),
  },
  (t) => [
    primaryKey({ columns: [t.room, t.handle] }),
    // A pane is in a room at most once at a time.
    uniqueIndex('members_one_per_pane')
      .on(t.room, t.pane_id)
      .where(sql`${t.status} IN ('pending', 'active')`),
    check(
      'members_handle',
      sql`${t.handle} GLOB '[a-z0-9]*' AND ${t.handle} NOT GLOB '*[^a-z0-9_-]*'`,
    ),
    check('members_status', sql`${t.status} IN (${oneOf(MEMBER_STATUSES)})`),
    check(
      'members_active_bound',
      sql`${t.status} <> 'active' OR (${t.terminal_id} IS NOT NULL AND ${t.agent} IS NOT NULL)`,
    ),
  ],
);

// Messages waiting for delivery: one row per recipient, deleted once delivered to it. Nothing else
// keeps message text. sender: the member the row is from or about.
// kind: a 'message' (a post, which prompts the recipient); an 'fyi' post, which needs no reply and so
// prompts nobody, arriving with the recipient's next message; a notice that the sender 'joined' or
// 'left' the room, which prompts nobody and arrives with the recipient's next message; or a warning
// to a post's author that its delivery to the sender may not have arrived ('undelivered', which
// prompts, so the author learns it even if nothing else is said).
// re: the id of the message this one answers, shown to the recipient (it routes nothing).
// unsure: a delivery of it failed in a way where it may still have arrived; it is not sent on its
// own again, only repeated (marked as such) with the recipient's next message.
export const queue = sqliteTable(
  'queue',
  {
    room: text().notNull(),
    recipient: text().notNull(),
    message_id: integer().notNull(),
    sender: text().notNull(),
    kind: text({ enum: QUEUE_KINDS }).notNull(),
    re: integer(),
    text: text().notNull(),
    unsure: integer({ mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.room, t.recipient, t.message_id] }),
    check('queue_text', sql`length(${t.text}) BETWEEN 1 AND ${sql.raw(String(MAX_MESSAGE_CHARS))}`),
    check('queue_kind', sql`${t.kind} IN (${oneOf(QUEUE_KINDS)})`),
    check('queue_unsure', sql`${t.unsure} IN (0, 1)`),
  ],
);

// What ticks and posts report, for `herdr-agent-hub status`. room is null for notices about
// herdr-agent-hub as a whole.
export const log = sqliteTable('log', {
  id: integer().primaryKey({ autoIncrement: true }),
  room: text(),
  at: integer().notNull(),
  text: text().notNull(),
});
