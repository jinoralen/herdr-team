// The single row that lets one tick at a time serve every room.

import { eq, getTableColumns } from 'drizzle-orm';
import { dbPath, openDb, transaction } from './db.ts';
import { service } from './tables.ts';

const HEARTBEAT_STALE_MS = 5000;
const { id: _serviceId, ...serviceColumns } = getTableColumns(service);
type ServiceState = Omit<typeof service.$inferSelect, 'id'>;

export function serviceState(root: string): ServiceState {
  const state = openDb(root).select(serviceColumns).from(service).where(eq(service.id, 1)).get();
  if (!state) {
    throw new Error(`${dbPath(root)} has no service row.`);
  }
  return state;
}

// The lock's own columns; last_message_id belongs to the queue (Store.enqueue) and is left alone.
export function saveServiceState(root: string, state: Omit<ServiceState, 'last_message_id'>): void {
  const { owner, heartbeat, closed, dirty } = state;
  openDb(root)
    .update(service)
    .set({ owner, heartbeat, closed, dirty })
    .where(eq(service.id, 1))
    .run();
}

export function isLockHeld(state: ServiceState, now = Date.now()): boolean {
  return !state.closed && now - state.heartbeat < HEARTBEAT_STALE_MS;
}

export function serviceTransaction<T>(root: string, fn: () => T): T {
  return transaction(openDb(root), fn);
}
