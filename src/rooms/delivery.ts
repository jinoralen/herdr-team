// Delivering what waits for each member as one prompt, when its agent is ready for input.
//
// Prompts take seconds each, and agents' commands (join, message, leave) don't wait for the tick, so
// everything a prompt depends on is read again just before it: the member, whose posts may go out,
// the member's queue, and the agent's state in Herdr.

import { formatDelivery } from '#agent';
import type { Agent } from '#herdr';
import type { Member, Queued } from '#store';
import type { Router } from './router.ts';
import { findPane, heldReason } from './rules.ts';

// The prompt is one argv entry for `herdr agent prompt`, and Linux caps one at 128 KiB. A queue
// bigger than this goes out in order over several deliveries; any one message fits (MAX_MESSAGE_CHARS).
const MAX_PROMPT_BYTES = 100_000;

// Errors Herdr reports before typing anything, so the messages simply wait for the next pass:
// the agent is stuck on a question, or its pane is gone (the next pass removes the member).
const NOTHING_SENT: Record<string, string> = {
  agent_blocked: 'became blocked; will retry when it is ready',
  agent_not_found: 'is no longer in Herdr; nothing was sent',
};

// Posts and warnings prompt their recipient; FYI posts, join/leave notices, and messages of a delivery
// that may have failed only go out with something that does.
const prompts = (q: Queued): boolean =>
  (q.kind === 'message' || q.kind === 'undelivered') && !q.unsure;
// What an agent wrote (as opposed to a notice or warning about it).
const isPost = (q: Queued): boolean => q.kind === 'message' || q.kind === 'fyi';

export async function deliver(room: Router): Promise<void> {
  for (const member of [...room.members.values()]) {
    if (!room.active()) {
      return; // checked before every prompt: earlier ones may have taken a while
    }
    // A failure for one member (e.g. Herdr timing out on its pane) must not stop the others.
    try {
      await deliverTo(room, member);
    } catch (error) {
      room.log(`error delivering to @${member.handle}: ${(error as Error).message}`);
    }
  }
}

async function deliverTo(room: Router, synced: Member): Promise<void> {
  // It may have left (or its handle been reused) while earlier prompts ran.
  const member = room.store.current(synced);
  if (!member) {
    room.members.delete(synced.handle);
    return;
  }
  const queued = waiting(room, member);
  if (!queued.some(prompts)) {
    return;
  }
  const live = await readyAgent(room, member);
  if (live) {
    await prompt(room, member, live, fitting(room, member, queued));
  }
}

// What waits for the member, oldest first. Posts from agents whose join isn't confirmed yet wait;
// they are dropped if it is refused.
function waiting(room: Router, member: Member): Queued[] {
  const pending = new Set(room.store.members('pending').map((m) => m.handle));
  return room.store.queued(member.handle).filter((q) => !pending.has(q.from));
}

// The member's agent as Herdr sees it now, if it can take a prompt; otherwise why not is logged
// (once per reason, also across ticks: member.held is stored) and null returned.
async function readyAgent(room: Router, member: Member): Promise<Agent | null> {
  // The member's pane, asked again just before typing. If it closed or moved away meanwhile, the
  // messages wait and the next pass removes the member.
  const now = await room.herdr.pane(member.pane_id);
  const live = now ? findPane(member, [now]) : undefined;
  if (!live) {
    return null;
  }
  if (!live.agent) {
    dropPosts(room, member);
  }
  const held = heldReason(live);
  if (held && held !== member.held && room.store.setHeld(member, held)) {
    const count = waiting(room, member).length; // after any posts were dropped
    if (count) {
      room.log(`… holding ${count} message(s) for @${member.handle}: ${held}.`);
    }
  }
  if (!held && member.held) {
    room.store.setHeld(member, null);
  }
  return held ? null : live;
}

// No recognized agent is in the member's pane: its posts are dropped, and their authors still in the
// room are told. Notices and warnings for it wait for whichever agent comes next.
function dropPosts(room: Router, member: Member): void {
  const dropped = room.store.transaction(() => {
    if (!room.active() || !room.store.current(member)) {
      return [];
    }
    // Read again here, after the wait on Herdr: what waits now is what is dropped.
    const posts = waiting(room, member).filter(isPost);
    const ids = posts.map((e) => e.id);
    room.store.withdrawWarnings(member.handle, ids);
    warnAuthors(
      room,
      member,
      posts,
      (e) =>
        `Your message ${e.id} to @${member.handle} ${e.unsure ? 'may not have arrived, and will not be repeated' : 'was not delivered'}: no agent is running in its pane, so it was dropped. Send it again once @${member.handle} is back, or tell your user.`,
    );
    room.store.dequeue(member.handle, ids);
    return ids;
  });
  if (dropped.length) {
    room.log(
      `✗ dropped ${dropped.join(',')} for @${member.handle}: no agent is running in its pane; their authors were told.`,
    );
  }
}

// The oldest messages that fit in one prompt (at least one), and that prompt.
function fitting(
  room: Router,
  member: Member,
  queued: Queued[],
): { entries: Queued[]; text: string } {
  const others = [...room.members.keys()].filter((h) => h !== member.handle);
  const render = (entries: Queued[]): string =>
    formatDelivery({
      handle: member.handle,
      entries,
      others,
      // Notices only repeat what members see anyway; they aren't worth a "may repeat" note.
      repeated: entries.filter((e) => e.unsure && isPost(e)).map((e) => e.id),
    });
  let count = queued.length;
  let text = render(queued);
  while (count > 1 && Buffer.byteLength(text) > MAX_PROMPT_BYTES) {
    count--;
    text = render(queued.slice(0, count));
  }
  return { entries: queued.slice(0, count), text };
}

async function prompt(
  room: Router,
  member: Member,
  live: Agent,
  { entries, text }: { entries: Queued[]; text: string },
): Promise<void> {
  const ids = entries.map((e) => e.id);
  const fresh = entries.filter((e) => !e.unsure).map((e) => e.id);
  // Write-ahead: until Herdr confirms it, the delivery may or may not arrive, and this pass may die
  // with it. So, before typing, the batch is marked unsure (a later pass won't send it on its own)
  // and its authors are warned; both are undone once the outcome is known. Checked again here,
  // after the wait on Herdr: the lock, the member (it may have left or rejoined) and the batch.
  const ready = room.store.transaction(() => {
    if (!room.active() || !room.store.current(member)) {
      return false;
    }
    const still = new Set(room.store.queued(member.handle).map((q) => q.id));
    if (!ids.every((id) => still.has(id))) {
      return false;
    }
    room.store.setUnsure(member.handle, fresh, true);
    // FYI posts asked for no reply, so losing one isn't worth waking their author.
    warnAuthors(
      room,
      member,
      entries.filter((e) => e.kind === 'message' && !e.unsure),
      (e) =>
        `Your message ${e.id} to @${member.handle} may not have arrived: the delivery failed or was interrupted. It is repeated, marked "may repeat", with @${member.handle}'s next message; if it can't wait, send it again or tell your user.`,
    );
    return true;
  });
  if (!ready) {
    return;
  }
  try {
    // Returns once the agent has started a turn on it, so it is never prompted twice in a row.
    await room.herdr.prompt(live.pane_id, text);
  } catch (caught) {
    const error = caught as { code?: string; message: string };
    const unsent = error.code ? NOTHING_SENT[error.code] : undefined;
    if (unsent) {
      room.store.transaction(() => {
        room.store.setUnsure(member.handle, fresh, false);
        room.store.withdrawWarnings(member.handle, fresh);
      });
      room.log(`… @${member.handle} ${unsent}.`);
      return;
    }
    // Anything else (including a prompt that typed in but started no turn) may or may not have
    // reached the agent. Typing it again now could double it, so it stays marked: it goes out again
    // with this member's next message, and the warnings tell its authors.
    room.log(
      `! delivery of ${ids.join(',')} to @${member.handle} failed (${error.code}: ${error.message}). It may or may not have arrived; it is repeated with the next message for @${member.handle}, and its authors were told.`,
    );
    return;
  }
  // Delivered, whichever pass holds the lock by now, and so is anything repeated in it: no warning
  // about these posts is needed any more. What didn't fit stays queued for the next idle.
  room.store.transaction(() => {
    room.store.dequeue(member.handle, ids);
    room.store.withdrawWarnings(member.handle, ids);
  });
  room.log(`→ delivered ${ids.join(',')} to @${member.handle}`);
}

// Queues, for the author of each of these posts (if still in the room), a warning about its delivery
// to `member`: one per post, linked to it by re, so it can be withdrawn once that post is delivered.
function warnAuthors(
  room: Router,
  member: Member,
  posts: Queued[],
  text: (post: Queued) => string,
): void {
  const inRoom = room.store.handles();
  for (const e of posts) {
    if (inRoom.includes(e.from)) {
      room.store.enqueue(member.handle, text(e), [e.from], { kind: 'undelivered', re: e.id });
    }
  }
}
