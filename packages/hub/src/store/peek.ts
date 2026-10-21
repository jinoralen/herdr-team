// Reading a room without opening the database for use: for shell completion and the top of
// `--help`, which only show things and must never create, migrate or set aside the database the
// way openDb does.

import type { Database } from 'bun:sqlite';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { isCurrentSchema, openReadOnly } from './db.ts';
import type { MemberStatus } from './store.ts';
import { members } from './tables.ts';

// A room's members in the given statuses, read-only. Empty when there is no database, when it is
// from another build (it is left as it is: the next command or tick deals with it), or when it
// can't be read at all.
export function peekMembers(
  root: string,
  room: string,
  statuses: MemberStatus[],
): { handle: string; description: string; pane_id: string; status: MemberStatus }[] {
  let client: Database | null = null;
  try {
    client = openReadOnly(root);
    if (!client || !isCurrentSchema(client)) {
      return [];
    }
    return drizzle({ client })
      .select({
        handle: members.handle,
        description: members.description,
        pane_id: members.pane_id,
        status: members.status,
      })
      .from(members)
      .where(and(eq(members.room, room), inArray(members.status, statuses)))
      .orderBy(asc(members.handle))
      .all();
  } catch {
    return [];
  } finally {
    client?.close();
  }
}
