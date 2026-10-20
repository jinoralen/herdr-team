// Reading a room without opening the database for use: for shell completion, which runs on every
// Tab press and must never create, migrate or set aside the database the way openDb does.

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { dbPath, isCurrentSchema } from './db.ts';
import { members } from './tables.ts';

// The active members of a room, read-only. Empty when there is no database, when it is from
// another build (it is left as it is: the next command or tick deals with it), or when it can't be
// read at all.
export function peekActiveMembers(
  root: string,
  room: string,
): { handle: string; description: string; pane_id: string }[] {
  if (!fs.existsSync(dbPath(root))) {
    return [];
  }
  let client: Database | null = null;
  try {
    client = new Database(dbPath(root), { readonly: true });
    if (!isCurrentSchema(client)) {
      return [];
    }
    return drizzle({ client })
      .select({
        handle: members.handle,
        description: members.description,
        pane_id: members.pane_id,
      })
      .from(members)
      .where(and(eq(members.room, room), eq(members.status, 'active')))
      .orderBy(asc(members.handle))
      .all();
  } catch {
    return [];
  } finally {
    client?.close();
  }
}
