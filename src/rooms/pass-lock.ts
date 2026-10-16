// The lock passes take turns through: one row in the database (see the store's lock.ts) holding the
// owner's token and a heartbeat. A lock whose heartbeat is a few seconds old counts as abandoned.

import { randomUUID } from 'node:crypto';
import { isLockHeld, saveServiceState, serviceState, serviceTransaction } from '#store';

export class PassLock {
  readonly owner = randomUUID();
  closed = false;
  lost = false; // another pass took the lock (e.g. after this process was suspended)
  private readonly root: string;
  private readonly now: () => number;

  constructor(root: string, now: () => number) {
    this.root = root;
    this.now = now;
  }

  // Takes the lock if it is free. If another pass holds it, asks that one to run again and returns false.
  take(): boolean {
    return serviceTransaction(this.root, () => {
      if (this.tryTake()) {
        return true;
      }
      saveServiceState(this.root, { ...serviceState(this.root), dirty: true });
      return false;
    });
  }

  // Lets go of the lock, unless a pass was requested meanwhile: then keeps it and returns 'again'.
  release(): 'again' | 'released' | 'lost' {
    if (this.closed) {
      return 'lost';
    }
    return serviceTransaction(this.root, () => {
      // If another pass took over, the lock is its now: leave it alone.
      if (!this.owns()) {
        return 'lost';
      }
      const state = serviceState(this.root);
      if (state.dirty) {
        saveServiceState(this.root, { ...state, heartbeat: this.now(), dirty: false });
        return 'again';
      }
      this.closed = true;
      saveServiceState(this.root, { ...state, heartbeat: this.now(), closed: true });
      return 'released';
    });
  }

  // Whether this pass still holds the lock. Checked in the database, not cached, because this
  // process may have been suspended long enough for another pass to take over.
  owns(): boolean {
    if (this.closed) {
      return false;
    }
    if (serviceState(this.root).owner === this.owner) {
      return true;
    }
    this.lost = this.closed = true;
    return false;
  }

  // Keeps the lock. Call it often (every second): others treat the lock as abandoned when the
  // heartbeat is older than a few seconds, and a single Herdr call can take longer.
  renew(): void {
    if (this.closed) {
      return;
    }
    serviceTransaction(this.root, () => {
      if (!this.owns()) {
        throw new Error(
          'Another herdr-agent-hub took over (this one was unresponsive too long). Stopping.',
        );
      }
      saveServiceState(this.root, { ...serviceState(this.root), heartbeat: this.now() });
    });
  }

  private tryTake(): boolean {
    if (isLockHeld(serviceState(this.root), this.now())) {
      return false;
    }
    saveServiceState(this.root, {
      owner: this.owner,
      heartbeat: this.now(),
      closed: false,
      dirty: false,
    });
    return true;
  }
}
