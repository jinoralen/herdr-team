// Deployment ownership lives in compose.db, independent of hub membership;
// a separate SQLite lock serializes up/down and is released by the kernel if the process dies.
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { z } from 'zod';
import migration from '../../drizzle/0000_init.sql' with { type: 'text' };
import { deploymentRecords } from './tables.ts';

const ManagedAgentSchema = z.object({
  handle: z.string(),
  fingerprint: z.string(),
  // The fingerprint's parts (definition, handle, cwd, purpose, context), to say what changed.
  parts: z.record(z.string(), z.string()).optional(),
  pane: z.string(),
  terminal: z.string(),
  joinedAt: z.string().nullable(),
  session: z.string().nullable(),
  phase: z.enum(['created', 'started', 'ready']),
});
const ManagedTabSchema = z.object({
  id: z.string(),
  root: z.string().nullable(),
  layout: z.enum(['rows', 'columns']),
  order: z.array(z.string()),
});
const DeploymentSchema = z.object({
  room: z.string(),
  name: z.string(),
  agents: z.record(z.string(), ManagedAgentSchema),
  tabs: z.record(z.string(), ManagedTabSchema),
  retired: z.array(z.object({ id: z.string(), root: z.string().nullable() })),
  allocations: z.array(
    z.object({ label: z.string(), pane: z.string().nullable(), tab: z.string().nullable() }),
  ),
});
export type Deployment = z.infer<typeof DeploymentSchema>;
export type ManagedAgent = z.infer<typeof ManagedAgentSchema>;
export type ManagedTab = z.infer<typeof ManagedTabSchema>;

function directory(root: string): string {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.statSync(root).uid !== process.getuid?.()) {
    throw new Error(`${root} is owned by another user; refusing to use it.`);
  }
  return root;
}
function database(root: string): BunSQLiteDatabase & { $client: Database } {
  const client = new Database(path.join(directory(root), 'compose.db'));
  try {
    client.exec('PRAGMA busy_timeout = 5000');
    client.exec('PRAGMA journal_mode = WAL');
    client.exec('BEGIN IMMEDIATE');
    const id = client
      .query<{ application_id: number }, []>('PRAGMA application_id')
      .get()?.application_id;
    const expected = Bun.hash.crc32(migration) | 0;
    if (id === 0) {
      client.exec(migration);
      client.exec(`PRAGMA application_id = ${expected}`);
    } else if (id !== expected) {
      throw new Error(
        'Compose ownership schema is incompatible. Restore the matching build; ownership was preserved.',
      );
    }
    client.exec('COMMIT');
    return drizzle({ client });
  } catch (error) {
    client.close();
    throw error;
  }
}
export function deployments(root: string, room: string): Deployment[] {
  const db = database(root);
  try {
    return db
      .select()
      .from(deploymentRecords)
      .where(eq(deploymentRecords.room, room))
      .orderBy(deploymentRecords.name)
      .all()
      .map((row) => {
        const record = DeploymentSchema.parse(JSON.parse(row.record));
        if (record.room !== room || record.name !== row.name) {
          throw new Error(
            'Compose ownership record does not match its key. Restore the matching ownership database.',
          );
        }
        return record;
      });
  } finally {
    db.$client.close();
  }
}
export function saveDeployment(root: string, state: Deployment): void {
  const db = database(root);
  try {
    const record = DeploymentSchema.parse(state);
    db.insert(deploymentRecords)
      .values({ room: record.room, name: record.name, record: JSON.stringify(record) })
      .onConflictDoUpdate({
        target: [deploymentRecords.room, deploymentRecords.name],
        set: { record: JSON.stringify(record) },
      })
      .run();
  } finally {
    db.$client.close();
  }
}
export function deleteDeployment(root: string, state: Deployment): void {
  const db = database(root);
  try {
    db.delete(deploymentRecords)
      .where(and(eq(deploymentRecords.room, state.room), eq(deploymentRecords.name, state.name)))
      .run();
  } finally {
    db.$client.close();
  }
}
export async function withDeploymentLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const lock = new Database(path.join(directory(root), 'lock.db'));
  try {
    // Fail fast rather than freezing this process's event loop behind a long agent startup.
    try {
      lock.exec('BEGIN EXCLUSIVE');
    } catch (error) {
      throw new Error(
        `Cannot lock deployment state (${(error as Error).message}). If another up/down is running, retry after it finishes.`,
      );
    }
    try {
      return await fn();
    } finally {
      lock.exec('ROLLBACK');
    }
  } finally {
    lock.close();
  }
}

export function rootDir(env = process.env): string {
  if (!process.getuid) {
    throw new Error('herdr-compose requires Linux or macOS.');
  }
  // Compose runs from any folder, and hub from others: a relative path would split the state.
  if (env.HERDR_TEAM_STATE_DIR && !path.isAbsolute(env.HERDR_TEAM_STATE_DIR)) {
    throw new Error('HERDR_TEAM_STATE_DIR must be an absolute path.');
  }
  // Compose's own folder under the state base it shares with hub; it never opens hub's.
  const base = path.join(
    env.HERDR_TEAM_STATE_DIR || path.join('/tmp', `herdr-team-${process.getuid()}`),
    'compose',
  );
  return env.HERDR_SOCKET_PATH
    ? path.resolve(
        base,
        `session-${Bun.hash.crc32(path.resolve(env.HERDR_SOCKET_PATH)).toString(16)}`,
      )
    : path.resolve(base);
}
