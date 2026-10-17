// Delivering what waits for each member as one prompt, when its agent is ready for input.
//
// Prompts take seconds each, and agents' commands (join, message, leave) don't wait for the tick, so
// everything a prompt depends on is read again just before it: the member, whose posts may go out,
// the member's queue, and the agent's state in Herdr.

import { formatDelivery } from '#agent';
import type { Agent } from '#herdr';
import type { Member, Queued } from '#store';
import type { Router, RuntimeMember } from './router.ts';
import { heldReason, stillThere } from './rules.ts';

// The prompt is one argv entry for `herdr agent prompt`, and Linux caps one at 128 KiB. A queue
// bigger than this goes out in order over several deliveries; any one message fits (MAX_MESSAGE_CHARS).
const MAX_PROMPT_BYTES = 100_000;

// A blocked agent received nothing; keep its messages for the next pass.
const NOTHING_SENT: Record<string, string> = {
  agent_blocked: 'became blocked; will retry when it is ready',
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

async function deliverTo(room: Router, runtime: RuntimeMember): Promise<void> {
  // It may have left (or its handle been reused) while earlier prompts ran.
  const member = room.store.current(runtime);
  if (!member) {
    room.members.delete(runtime.handle);
    return;
  }
  // Posts from agents whose join isn't confirmed yet wait; they are dropped if it is refused.
  const pending = new Set(room.store.members('pending').map((m) => m.handle));
  const queued = room.store.queued(member.handle).filter((q) => !pending.has(q.from));
  if (!queued.length || (runtime.live?.agent && !queued.some(prompts))) {
    return;
  }
  const live = await readyAgent(room, runtime, member, queued);
  if (live && queued.some(prompts)) {
    await prompt(room, member, live, fitting(room, member, queued));
  }
}

// The member's agent as Herdr sees it now, if it can take a prompt; otherwise why not is logged
// (once per reason, also across ticks: member.held is stored) and null returned.
async function readyAgent(
  room: Router,
  runtime: RuntimeMember,
  member: Member,
  queued: Queued[],
): Promise<Agent | null> {
  // Recheck the pane immediately before typing.
  const now = runtime.live && (await room.herdr.agent(runtime.live.pane_id));
  const found = now ? stillThere(member, [now]) : undefined;
  const live = found?.agent ? found : null;
  if (!live) {
    failDelivery(room, member, queued);
    return null;
  }
  const held = heldReason(live);
  if (held && held !== member.held && room.store.setHeld(member, held)) {
    room.log(`… holding ${queued.length} message(s) for @${member.handle}: ${held}.`);
  }
  if (!held && member.held) {
    room.store.setHeld(member, null);
  }
  return held ? null : live;
}

// No agent is present: discard these items and report each lost post, including FYIs.
function failDelivery(room: Router, member: Member, entries: Queued[]): void {
  room.store.transaction(() => {
    if (!room.active() || !room.store.current(member)) {
      return;
    }
    const ids = entries.map((e) => e.id);
    room.store.setHeld(member, null);
    room.store.withdrawWarnings(member.handle, ids);
    const handles = room.store.handles();
    for (const e of entries) {
      if (isPost(e) && handles.includes(e.from)) {
        room.store.enqueue(
          member.handle,
          `Your message ${e.id} to @${member.handle} could not be delivered: no agent is running in its pane. The message was dropped.`,
          [e.from],
          { kind: 'undelivered', re: e.id },
        );
      }
    }
    room.store.dequeue(member.handle, ids);
  });
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
    warnAuthors(room, member, entries);
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
    if (error.code === 'agent_not_found') {
      failDelivery(room, member, entries);
      return;
    }
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

// Queues, for the author of each post in the batch (if still in the room), a warning that it may not
// have reached `member`: one per post, linked to it by re, so it can be withdrawn once that post is
// delivered. FYI posts asked for no reply, so losing one isn't worth waking their author.
function warnAuthors(room: Router, member: Member, entries: Queued[]): void {
  const inRoom = room.store.handles();
  for (const e of entries) {
    if (e.kind === 'message' && !e.unsure && inRoom.includes(e.from)) {
      room.store.enqueue(
        member.handle,
        `Your message ${e.id} to @${member.handle} may not have arrived: the delivery failed or was interrupted. It is repeated, marked "may repeat", with @${member.handle}'s next message; if it can't wait, send it again or tell your user.`,
        [e.from],
        { kind: 'undelivered', re: e.id },
      );
    }
  }
}
