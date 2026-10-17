// Opening the database: one connection per state directory, migrated on first use, and
// transactions that nest by joining the outer one.

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import migration0000 from '../../drizzle/0000_init.sql' with { type: 'text' };
import { log, service } from './tables.ts';

// drizzle/ migrations, oldest first, built into the executable. The database's user_version is how
// many of them it has; opening it applies the rest. There is one: `bun run db:generate` regenerates
// it, and a database from any other schema is set aside (docs/adr/0010-state-is-disposable.md).
const MIGRATIONS: string[] = [migration0000];

// Which migrations a database was built from: a checksum of their SQL, kept in its application_id.
// A database from a build with other migrations (an older development build, or a newer release)
// doesn't match, even with the same user_version.
const schemaId = (count: number): number =>
  Bun.hash.crc32(MIGRATIONS.slice(0, count).join('\n')) | 0;

// Drizzle's query builder, plus the bun:sqlite connection under it ($client) for raw SQL.
export type Db = BunSQLiteDatabase & { $client: Database };

// The user's ID, which names the default state directory and must own it. Herdr's plugin
// platforms (Linux, macOS) always have one.
function uid(): number {
  if (!process.getuid) {
    throw new Error('herdr-agent-hub needs Linux or macOS (process.getuid is missing).');
  }
  return process.getuid();
}

// One state directory per Herdr session (server), named for its socket: pane and workspace IDs are
// only unique within one. Herdr gives every pane and plugin command HERDR_SOCKET_PATH; without it
// (run by hand outside Herdr), the base directory itself.
export function rootDir(env = process.env): string {
  // /tmp is writable from Codex's default workspace-write sandbox; override with HERDR_AGENT_HUB_DIR.
  const base = env.HERDR_AGENT_HUB_DIR || path.join('/tmp', `herdr-agent-hub-${uid()}`);
  const socket = env.HERDR_SOCKET_PATH;
  if (!socket) {
    return path.resolve(base);
  }
  return path.resolve(base, `session-${Bun.hash.crc32(path.resolve(socket)).toString(16)}`);
}

export function dbPath(root: string): string {
  return path.join(root, 'chat.db');
}

// Where agents put content too long for a message, and post its path instead. Created on demand.
export function filesDir(root: string): string {
  const dir = path.join(root, 'files');
  ensureDir(dir);
  return dir;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = fs.statSync(dir);
  if (info.uid !== uid()) {
    throw new Error(`${dir} is owned by another user; refusing to use it.`);
  }
}

const open = new Map<string, Db>();

export function openDb(root: string): Db {
  const cached = open.get(root);
  if (cached) {
    return cached;
  }
  ensureDir(root);
  let client = connect(root);
  // The database only holds who is in which room and what waits for delivery, so one this build
  // can't read is set aside rather than blocking every tick and command. Agents join again.
  let setAside: string | null = null;
  if (!compatible(client)) {
    client.close();
    // Under a lock, and checked again: another process may have just replaced it.
    ({ client, setAside } = withReplaceLock(root, () => {
      const again = connect(root);
      if (compatible(again)) {
        return { client: again, setAside: null };
      }
      again.close();
      const aside = moveAside(root);
      return { client: connect(root), setAside: aside };
    }));
  }
  client.exec('PRAGMA journal_mode = WAL;');
  const db = drizzle({ client });
  // Several processes may open a new database at once; IMMEDIATE makes one of them migrate it.
  transaction(db, () => {
    migrate(db);
    if (setAside) {
      const text = `! ${dbPath(root)} was made by an incompatible herdr-agent-hub build; moved it to ${setAside} and started fresh. Agents must join again.`;
      db.insert(log).values({ room: null, at: Date.now(), text }).run();
      console.error(text);
    }
  });
  open.set(root, db);
  return db;
}

// Checked before anything is written to it (e.g. the WAL journal mode), so a database that is set
// aside is left as it was. A file that isn't a database fails here, and is reported, not replaced.
function connect(root: string): Database {
  const client = new Database(dbPath(root));
  client.exec('PRAGMA busy_timeout = 5000;');
  return client;
}

function pragma(client: Database, name: 'user_version' | 'application_id'): number {
  const row = client.query<Record<string, number>, []>(`PRAGMA ${name}`).get();
  return row?.[name] ?? 0;
}

// A new file, or one built from a prefix of this build's migrations.
function compatible(client: Database): boolean {
  const version = pragma(client, 'user_version');
  return (
    version === 0 ||
    (version <= MIGRATIONS.length && pragma(client, 'application_id') === schemaId(version))
  );
}

// Runs fn while holding an exclusive lock on <chat.db>.replace-lock, a small SQLite file that is never
// moved. SQLite's locks are the kernel's advisory file locks, so a process that dies releases its
// lock, and there is no stale lock to take over; the others wait (busy_timeout).
function withReplaceLock<T>(root: string, fn: () => T): T {
  const lock = new Database(`${dbPath(root)}.replace-lock`);
  try {
    lock.exec('PRAGMA busy_timeout = 20000; BEGIN EXCLUSIVE;');
    try {
      return fn();
    } finally {
      lock.exec('COMMIT');
    }
  } finally {
    lock.close();
  }
}

// Renames the database and its WAL files to <chat.db>.incompatible-<time>; returns that name.
function moveAside(root: string): string {
  const aside = `${dbPath(root)}.incompatible-${new Date().toISOString().replace(/[-:.]/g, '')}`;
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath(root) + suffix)) {
      fs.renameSync(dbPath(root) + suffix, aside + suffix);
    }
  }
  return aside;
}

function migrate(db: Db): void {
  const client = db.$client;
  for (const migration of MIGRATIONS.slice(pragma(client, 'user_version'))) {
    client.exec(migration);
  }
  client.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  client.exec(`PRAGMA application_id = ${schemaId(MIGRATIONS.length)}`);
  db.insert(service).values({ id: 1 }).onConflictDoNothing().run();
}

const inTransaction = new WeakSet<Db>();

// Nested calls join the outer transaction.
export function transaction<T>(db: Db, fn: () => T): T {
  if (inTransaction.has(db)) {
    return fn();
  }
  db.$client.exec('BEGIN IMMEDIATE');
  inTransaction.add(db);
  try {
    const result = fn();
    db.$client.exec('COMMIT');
    return result;
  } catch (error) {
    db.$client.exec('ROLLBACK');
    throw error;
  } finally {
    inTransaction.delete(db);
  }
}
