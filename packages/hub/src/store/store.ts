// One room's rows: its members and the messages waiting for them. Every method is scoped to the room.

import { and, asc, desc, eq, getTableColumns, inArray, notInArray, sql } from 'drizzle-orm';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { type Db, isCurrentSchema, openDb, openReadOnly, transaction } from './db.ts';
import { members, queue, service } from './tables.ts';

// Store methods already know their room, so they read and write members without it.
const { room: _memberRoom, ...memberColumns } = getTableColumns(members);

export type Member = Omit<typeof members.$inferSelect, 'room'>;
export type MemberStatus = Member['status'];
// A message as delivered: id is m<number>; from is the member it is from or about; re is the id of
// the message it answers, if its author said.
export type Entry = { id: string; from: string; kind: QueueKind; text: string; re: string | null };
export type QueueKind = (typeof queue.$inferSelect)['kind'];
// A message waiting for one recipient.
export type Queued = Entry & { unsure: boolean };
// What an agent wrote (as opposed to a notice or warning about it).
export const isPost = (q: Entry): boolean => q.kind === 'message' || q.kind === 'fyi';

const messageNumber = (id: string): number => Number(id.slice(1));

function checkRoomName(room: string): string {
  if (typeof room !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(room)) {
    throw new Error(
      `Invalid room ${JSON.stringify(room)}: expected a Herdr workspace ID such as w1.`,
    );
  }
  return room;
}

export class Store {
  private readonly db: Db;
  readonly root: string;
  readonly room: string;

  constructor(root: string, room: string) {
    this.root = root;
    this.room = checkRoomName(room);
    this.db = openDb(root);
  }

  transaction<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  // ---- members ----

  members(status: MemberStatus): Member[] {
    return this.db
      .select(memberColumns)
      .from(members)
      .where(and(eq(members.room, this.room), eq(members.status, status)))
      .orderBy(asc(members.handle))
      .all();
  }

  member(handle: string): Member | null {
    return (
      this.db
        .select(memberColumns)
        .from(members)
        .where(and(eq(members.room, this.room), eq(members.handle, handle)))
        .get() ?? null
    );
  }

  memberByPane(paneId: string): Member | null {
    return (
      this.db
        .select(memberColumns)
        .from(members)
        .where(
          and(
            eq(members.room, this.room),
            eq(members.pane_id, paneId),
            inArray(members.status, ['pending', 'active']),
          ),
        )
        .get() ?? null
    );
  }

  // The latest refused join from this pane, if that is the pane's last word.
  rejectionFor(paneId: string): Member | null {
    return (
      this.db
        .select(memberColumns)
        .from(members)
        .where(
          and(
            eq(members.room, this.room),
            eq(members.pane_id, paneId),
            eq(members.status, 'rejected'),
          ),
        )
        .orderBy(desc(members.joined_at))
        .limit(1)
        .get() ?? null
    );
  }

  // Handles of the room's members, and of joins the next tick will confirm.
  handles(): string[] {
    return this.db
      .select({ handle: members.handle })
      .from(members)
      .where(and(eq(members.room, this.room), inArray(members.status, ['pending', 'active'])))
      .orderBy(asc(members.handle))
      .all()
      .map((row) => row.handle);
  }

  // ---- membership changes ----
  // Agents' commands (join, leave) don't wait for the tick, so a tick's copy of a member can be out of
  // date. Each change applies only if the member is still the one the caller read (same join) and in
  // one of the expected states, and says whether it did; a caller that loses skips the member.

  // The member as stored now, if it is still the same join and still active.
  current(m: Member): Member | null {
    const now = this.member(m.handle);
    return now && now.joined_at === m.joined_at && now.status === 'active' ? now : null;
  }

  admit(pending: Member, agent: Pick<Member, 'terminal_id' | 'agent'>): boolean {
    return this.change(pending, ['pending'], { status: 'active', ...agent, held: null });
  }

  // A refused join takes back its notice and posts, and nothing more is queued for it.
  reject(pending: Member, reason: string | null): boolean {
    return this.transaction(() => {
      if (!this.change(pending, ['pending'], { status: 'rejected', reason })) {
        return false;
      }
      this.dropSender(pending.handle);
      this.dropRecipient(pending.handle);
      return true;
    });
  }

  // The member's pane now has another terminal (it moved) or runs another agent.
  rebind(m: Member, agent: Pick<Member, 'terminal_id' | 'agent'>): boolean {
    return this.change(m, ['active'], agent);
  }

  setHeld(m: Member, held: string | null): boolean {
    return this.change(m, ['active'], { held });
  }

  private change(m: Member, from: MemberStatus[], set: Partial<Member>): boolean {
    const changed = this.db
      .update(members)
      .set(set)
      .where(
        and(
          eq(members.room, this.room),
          eq(members.handle, m.handle),
          eq(members.joined_at, m.joined_at),
          inArray(members.status, from),
        ),
      )
      .returning({ handle: members.handle })
      .all();
    return changed.length > 0;
  }

  // A new join. Replaces the member with the same handle, e.g. one that left and whose handle is reused.
  saveMember(m: Member): void {
    const row = {
      description: m.description,
      pane_id: m.pane_id,
      joined_at: m.joined_at,
      status: m.status,
      terminal_id: m.terminal_id,
      agent: m.agent,
      reason: m.reason,
      held: m.held,
      instructions: m.instructions,
    };
    this.db
      .insert(members)
      .values({ room: this.room, handle: m.handle, ...row })
      .onConflictDoUpdate({ target: [members.room, members.handle], set: row })
      .run();
  }

  // ---- queue: messages waiting for delivery, one row per recipient ----

  // Queues a message for each recipient, under a new id. Returns the id (m17).
  enqueue(
    sender: string,
    text: string,
    recipients: string[],
    { kind = 'message', re = null }: { kind?: QueueKind; re?: string | null } = {},
  ): string {
    return this.transaction(() => {
      const row = this.db
        .update(service)
        .set({ last_message_id: sql`${service.last_message_id} + 1` })
        .where(eq(service.id, 1))
        .returning({ id: service.last_message_id })
        .get();
      if (!row) {
        throw new Error('The database has no service row.');
      }
      for (const handle of recipients) {
        this.db
          .insert(queue)
          .values({
            room: this.room,
            recipient: handle,
            message_id: row.id,
            sender,
            kind,
            re: re === null ? null : messageNumber(re),
            text,
          })
          .run();
      }
      return `m${row.id}`;
    });
  }

  // Whether `id` was ever handed out (messages aren't kept after delivery, so that's all we know).
  wasIssued(id: string): boolean {
    const n = messageNumber(id);
    const row = this.db
      .select({ last: service.last_message_id })
      .from(service)
      .where(eq(service.id, 1))
      .get();
    return Number.isSafeInteger(n) && n >= 1 && n <= (row?.last ?? 0);
  }

  // What waits for `recipient`, oldest first.
  queued(recipient: string): Queued[] {
    return this.db
      .select()
      .from(queue)
      .where(and(eq(queue.room, this.room), eq(queue.recipient, recipient)))
      .orderBy(asc(queue.message_id))
      .all()
      .map((row) => ({
        id: `m${row.message_id}`,
        from: row.sender,
        kind: row.kind,
        text: row.text,
        re: row.re === null ? null : `m${row.re}`,
        unsure: row.unsure,
      }));
  }

  // Delivered: these messages no longer wait for `recipient`.
  dequeue(recipient: string, ids: string[]): void {
    this.db
      .delete(queue)
      .where(and(this.forRecipient(recipient), inArray(queue.message_id, ids.map(messageNumber))))
      .run();
  }

  setUnsure(recipient: string, ids: string[], unsure: boolean): void {
    this.db
      .update(queue)
      .set({ unsure })
      .where(and(this.forRecipient(recipient), inArray(queue.message_id, ids.map(messageNumber))))
      .run();
  }

  // Withdraws the warnings that posts `ids` may not have reached `recipient` (it is their sender).
  withdrawWarnings(recipient: string, ids: string[]): void {
    this.db
      .delete(queue)
      .where(
        and(
          eq(queue.room, this.room),
          eq(queue.sender, recipient),
          eq(queue.kind, 'undelivered'),
          inArray(queue.re, ids.map(messageNumber)),
        ),
      )
      .run();
  }

  // Tells every other member that `handle` joined or left. It prompts nobody, and arrives with their
  // next message. Returns its id.
  announce(handle: string, kind: 'joined' | 'left', text: string): string {
    const others = this.handles().filter((h) => h !== handle);
    return this.enqueue(handle, text, others, { kind });
  }

  // Takes the member out of the room (left, gone): it gets nothing more, and the others are told
  // `@handle <why>.` Returns the notice's id, or null if the member had already changed.
  remove(member: Member, status: MemberStatus, why: string): string | null {
    return this.transaction(() => {
      const pending = this.member(member.handle)?.status === 'pending';
      if (!this.change(member, ['pending', 'active'], { status })) {
        return null;
      }
      if (pending) {
        this.dropSender(member.handle);
      }
      this.dropRecipient(member.handle);
      return this.announce(member.handle, 'left', `@${member.handle} ${why}.`);
    });
  }

  // Whether a post from `handle` still waits; notices and warnings about it do not reserve its handle.
  hasQueuedFrom(handle: string): boolean {
    return !!this.db
      .select({ id: queue.message_id })
      .from(queue)
      .where(and(eq(queue.room, this.room), sentBy(handle)))
      .limit(1)
      .get();
  }

  // Drop what waited for a removed recipient and correct delivery warnings for its posts.
  dropRecipient(handle: string): void {
    const posts = this.queued(handle).filter(isPost);
    this.withdrawWarnings(
      handle,
      posts.map((q) => q.id),
    );
    this.warnAuthors(
      handle,
      posts,
      (e) =>
        `Your message ${e.id} to @${handle} ${e.unsure ? 'may not have arrived, and will not be repeated' : 'was not delivered'}: the recipient left the room or its join was refused, so it was dropped. Send it again once @${handle} is back, or tell your user.`,
    );
    this.db.delete(queue).where(this.forRecipient(handle)).run();
  }

  // Warn authors still in the room; re links each warning to the post it describes.
  warnAuthors(handle: string, posts: Queued[], text: (post: Queued) => string): void {
    const inRoom = this.handles();
    for (const e of posts) {
      if (inRoom.includes(e.from)) {
        this.enqueue(handle, text(e), [e.from], { kind: 'undelivered', re: e.id });
      }
    }
  }

  // Takes back a pending member's join notice and posts. Warnings are about the member, for other
  // authors, so they stay; a left notice is its handle's previous member's, so it stays too.
  dropSender(handle: string): void {
    this.db
      .delete(queue)
      .where(
        and(
          eq(queue.room, this.room),
          eq(queue.sender, handle),
          notInArray(queue.kind, ['undelivered', 'left']),
        ),
      )
      .run();
  }

  private forRecipient(recipient: string): ReturnType<typeof and> {
    return and(eq(queue.room, this.room), eq(queue.recipient, recipient));
  }

  // The room's members for `status --json`, read without a write lock so ticks and posts don't wait
  // for it. No file, or one being created (schema version 0), is an empty room. Any other schema
  // goes through openDb like every other command: one from another build is set aside, and an
  // older one of this build's would be migrated.
  static snapshot(
    root: string,
    room: string,
  ): (Omit<Member, 'instructions'> & { queuedFrom: boolean })[] {
    checkRoomName(room);
    const client = openReadOnly(root);
    if (!client) {
      return [];
    }
    try {
      const version = client
        .query<{ user_version: number }, []>('PRAGMA user_version')
        .get()?.user_version;
      if (version === 0) {
        return [];
      }
      if (isCurrentSchema(client)) {
        return readSnapshot(drizzle({ client }), room);
      }
    } finally {
      client.close();
    }
    return readSnapshot(openDb(root), room);
  }
}

// What reserves a handle while it waits: posts from it, so a reply never reaches a newer member
// under that handle. Notices wake nobody, so they may wait for an idle recipient indefinitely, and
// warnings about it are for other authors: neither does. One condition for hasQueuedFrom and the
// snapshot's queuedFrom.
const sentBy = (handle: string | typeof members.handle): ReturnType<typeof and> =>
  and(eq(queue.sender, handle), inArray(queue.kind, ['message', 'fyi']));

// One statement, so it reads one consistent state of the room.
function readSnapshot(
  db: BunSQLiteDatabase,
  room: string,
): (Omit<Member, 'instructions'> & { queuedFrom: boolean })[] {
  return db
    .select({
      handle: members.handle,
      description: members.description,
      pane_id: members.pane_id,
      joined_at: members.joined_at,
      status: members.status,
      terminal_id: members.terminal_id,
      agent: members.agent,
      reason: members.reason,
      held: members.held,
      queuedFrom: sql<number>`exists ${db
        .select({ one: sql`1` })
        .from(queue)
        .where(and(eq(queue.room, members.room), sentBy(members.handle)))}`.mapWith(Boolean),
    })
    .from(members)
    .where(eq(members.room, room))
    .orderBy(asc(members.handle))
    .all();
}
