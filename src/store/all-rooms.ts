// Finds rooms that need a tick, and clears them all when Herdr starts.

import { inArray } from 'drizzle-orm';
import { openDb, transaction } from './db.ts';
import { appendLog } from './log.ts';
import { members, queue } from './tables.ts';

// Rooms with members to serve or joins to confirm; messages only ever wait for members.
export function busyRooms(root: string): string[] {
  return openDb(root)
    .selectDistinct({ room: members.room })
    .from(members)
    .where(inArray(members.status, ['pending', 'active']))
    .orderBy(members.room)
    .all()
    .map((row) => row.room);
}

// A Herdr server that just started has new panes, and may reuse the old ones' IDs: every member and
// everything waiting for one is dropped, and agents join again. Message IDs keep counting.
export function clearRooms(root: string): void {
  const db = openDb(root);
  transaction(db, () => {
    db.delete(queue).run();
    db.delete(members).run();
    appendLog(root, null, 'Herdr started: rooms cleared; agents must join again.');
  });
}
