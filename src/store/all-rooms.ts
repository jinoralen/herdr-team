// Finds rooms that need a tick.

import { inArray } from 'drizzle-orm';
import { openDb } from './db.ts';
import { members } from './tables.ts';

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
