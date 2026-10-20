// What ticks and posts report, kept for `herdr-team status`; the oldest rows are dropped past LOG_KEEP.

import { desc, eq, isNull, lte, or } from 'drizzle-orm';
import { openDb } from './db.ts';
import { log } from './tables.ts';

const LOG_KEEP = 5000;

export type LogRow = typeof log.$inferSelect;

export function appendLog(root: string, room: string | null, text: string): void {
  const db = openDb(root);
  const added = db
    .insert(log)
    .values({ room, at: Date.now(), text })
    .returning({ id: log.id })
    .get();
  db.delete(log)
    .where(lte(log.id, added.id - LOG_KEEP))
    .run();
}

// The newest `last` rows about `room` or about herdr-team as a whole, oldest first.
export function readLog(root: string, room: string, last: number): LogRow[] {
  return openDb(root)
    .select()
    .from(log)
    .where(or(eq(log.room, room), isNull(log.room)))
    .orderBy(desc(log.id))
    .limit(last)
    .all()
    .reverse();
}
