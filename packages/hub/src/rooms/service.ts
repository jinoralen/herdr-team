// One pass over every room: load them from the database, bring members up to date with Herdr, and
// deliver what waits for them. Herdr runs a pass (`herdr-team tick`) whenever an agent changes state.
// Nothing runs in between.
//
// Passes take turns through a lock in the database. A tick that finds the lock taken asks the holder
// to run once more and exits, so no request is lost and passes never overlap. Passes deliver queued
// room messages through Herdr, so those deliveries are naturally serialized.
import type { Agent, Herdr } from '@herdr/herdr';
import { busyRooms, clearRooms } from '#store';
import { PassLock } from './pass-lock.ts';
import { Router } from './router.ts';

// room: the workspace a log line is about, or null for notices about herdr-team as a whole.
type ServiceLog = (room: string | null, text: string) => void;
type ServiceOptions = { root: string; herdr: Herdr; log?: ServiceLog; now?: () => number };

export class Service {
  root: string;
  herdr: Herdr;
  log: ServiceLog;
  now: () => number;
  rooms = new Map<string, Router>(); // workspace ID -> its room, for this pass
  agents: Agent[] | null = null; // this pass's `herdr pane list`; null when Herdr is unreachable
  private readonly lock: PassLock;

  constructor({ root, herdr, log = (): void => {}, now = Date.now }: ServiceOptions) {
    this.root = root;
    this.herdr = herdr;
    this.log = log;
    this.now = now;
    this.lock = new PassLock(root, now);
  }

  // The lock itself is in pass-lock.ts; these keep the pass's own vocabulary.
  acquire(): boolean {
    return this.lock.take();
  }

  // Returns true if another pass was requested meanwhile: the caller runs it, still holding the lock.
  release(): boolean {
    return this.lock.release() === 'again';
  }

  owns(): boolean {
    return this.lock.owns();
  }

  heartbeat(): void {
    this.lock.renew();
  }

  get owner(): string {
    return this.lock.owner;
  }

  get lost(): boolean {
    return this.lock.lost;
  }

  // The room for a workspace, loaded on first use in this pass and synced with Herdr if the pass has its agents.
  private room(workspace: string): Router {
    let router = this.rooms.get(workspace);
    if (!router) {
      router = new Router({
        root: this.root,
        room: workspace,
        herdr: this.herdr,
        active: (): boolean => this.owns(),
        log: (text: string): void => this.log(workspace, text),
      });
      this.rooms.set(workspace, router);
      router.sync(this.agents);
    }
    return router;
  }

  // Loads every room with something to do and brings it up to date with Herdr.
  async load(): Promise<void> {
    this.heartbeat();
    this.rooms.clear();
    const rooms = busyRooms(this.root);
    this.agents = null;
    if (!rooms.length) {
      return;
    }
    try {
      this.agents = await this.herdr.listPanes();
    } catch (caught) {
      const error = caught as { code?: string; message: string };
      this.log(null, `! Herdr unavailable (${error.code}): ${error.message}. Deliveries wait.`);
    }
    if (!this.owns()) {
      return; // lost the lock while waiting on Herdr
    }
    // Like step(): one room's failure (e.g. a busy database) must not keep the others from running.
    for (const room of rooms) {
      try {
        this.room(room);
      } catch (error) {
        this.rooms.delete(room);
        this.log(room, `error: ${(error as Error).message}`);
      }
    }
  }

  // Delivers in every loaded room. One room's failure must not stop the others; what it couldn't
  // deliver stays queued for the next pass.
  async step(): Promise<void> {
    for (const [workspace, router] of this.rooms) {
      try {
        await router.step();
      } catch (error) {
        this.log(workspace, `error: ${(error as Error).message}`);
      }
    }
    this.heartbeat();
  }
}

// Keeps the lock fresh on its own timer while a pass waits on slow Herdr calls.
async function holding<T>(service: Service, fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    try {
      service.heartbeat();
    } catch {
      /* the pass notices through owns() */
    }
  }, 1000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

// `herdr-team tick`: runs passes until nobody asked for another one. Returns false if another
// pass held the lock (it was asked to run again instead). startup: Herdr's server just started, so
// the rooms of the one before are cleared first (a pass of that one still running then finds its
// members gone, and skips them).
export async function tick({
  startup = false,
  ...options
}: ServiceOptions & { startup?: boolean }): Promise<boolean> {
  if (startup) {
    clearRooms(options.root);
  }
  const service = new Service(options);
  if (!service.acquire()) {
    return false;
  }
  await holding(service, async () => {
    try {
      await passes(service);
    } catch (error) {
      // Run once more: another tick may have asked for a rerun meanwhile, and taking the lock again
      // clears that request, so dropping it here could leave a post waiting for the next event.
      // Not if the lock is lost: then the new holder runs the passes.
      if (!service.owns()) {
        throw error;
      }
      options.log?.(null, `error: ${(error as Error).message}; running the pass once more`);
      await passes(service);
    } finally {
      // After a second error, let go even if a rerun was requested: the next Herdr event runs one.
      while (service.release()) {}
    }
  });
  return true;
}

// Passes until nobody asked for another one.
async function passes(service: Service): Promise<void> {
  do {
    await service.load();
    await service.step();
  } while (service.release());
}
