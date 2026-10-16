// The router for one room (one Herdr workspace). Each tick (service.ts) makes one per room, brings
// its members up to date with Herdr and delivers what waits for them, then lets it go. Posts are
// queued by the agents' own `message` commands; the router only delivers them.

import type { Agent, Herdr } from '#herdr';
import { type Member, type MemberStatus, Store } from '#store';
import { deliver } from './delivery.ts';
import { admitPending, restoreMembers } from './membership.ts';

// live: the member's agent in this tick's `herdr agent list`; null while Herdr hasn't detected it yet.
export type RuntimeMember = Member & { live: Agent | null };
type Log = (text: string) => void;
// active: whether this router may still act; the tick passes a check that it still holds the lock.
type RouterOptions = {
  root: string;
  room: string;
  herdr: Herdr;
  log?: Log;
  active?: () => boolean;
};

// Membership (membership.ts) and delivery (delivery.ts) work on a Router too.
export class Router {
  room: string;
  herdr: Herdr;
  log: Log;
  store: Store;
  members = new Map<string, RuntimeMember>(); // handle -> active member, with its live agent
  // Whether this pass has Herdr's agent list. Without it, nobody can be found, so nothing is delivered.
  private synced = false;
  active: () => boolean;

  constructor({
    root,
    room,
    herdr,
    log = (): void => {},
    active = (): boolean => true,
  }: RouterOptions) {
    this.room = room;
    this.herdr = herdr;
    this.log = log;
    this.active = active;
    this.store = new Store(root, room);
  }

  // Brings membership up to date. agents: this tick's `herdr agent list`, shared by all rooms;
  // null while Herdr is unreachable, and then nothing changes and nothing is delivered.
  sync(agents: Agent[] | null): void {
    if (!agents || !this.active()) {
      return;
    }
    restoreMembers(this, agents);
    admitPending(this, agents);
    this.synced = true;
  }

  async step(): Promise<void> {
    if (this.synced && this.active()) {
      await deliver(this);
    }
  }

  addRuntime(member: Member, live: Agent | null): RuntimeMember {
    const runtime: RuntimeMember = { ...member, live };
    this.members.set(member.handle, runtime);
    return runtime;
  }

  // The member gets nothing more; the others are told.
  removeMember(member: Member, status: MemberStatus, why: string): void {
    this.members.delete(member.handle);
    const id = this.store.remove(member, status, why);
    if (id) {
      this.log(`${id} @${member.handle} ${why}.`);
    }
  }
}
