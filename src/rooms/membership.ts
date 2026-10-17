// Who is in a room, checked against Herdr at the start of each pass: stored members are found by
// their panes, and pending joins are admitted or refused. Like delivery.ts, these take the room.

import type { Agent } from '#herdr';
import type { Member } from '#store';
import type { Router } from './router.ts';
import { admissionProblem, findPane } from './rules.ts';

// Finds each stored member's pane. Membership belongs to the pane, whichever agent or session runs in
// it; a member whose pane closed, or moved to another workspace, leaves the room. (A pane keeps its
// id within its workspace; moved to another, it gets a new one, and only its terminal is the same.)
export function restoreMembers(room: Router, agents: Agent[]): void {
  const gone: [Member, string][] = [];
  for (const stored of room.store.members('active')) {
    const live = findPane(stored, agents);
    if (live) {
      room.addMember(rebound(room, stored, live));
    } else if (agents.some((a) => a.terminal_id === stored.terminal_id)) {
      gone.push([stored, 'left: its pane moved to another workspace']);
    } else {
      gone.push([stored, 'left: pane closed']);
    }
  }
  for (const [stored, why] of gone) {
    room.removeMember(stored, 'gone', why);
  }
}

// Records the pane's terminal and agent as Herdr reports them now, so `status` shows the agent there
// and a move away is told apart from a close. An empty pane keeps the last kind.
function rebound(room: Router, stored: Member, live: Agent): Member {
  const bound = { terminal_id: live.terminal_id, agent: live.agent ?? stored.agent };
  if (bound.terminal_id === stored.terminal_id && bound.agent === stored.agent) {
    return stored;
  }
  return room.store.rebind(stored, bound) ? { ...stored, ...bound } : stored;
}

export function admitPending(room: Router, agents: Agent[]): void {
  for (const pending of room.store.members('pending')) {
    const agent = agents.find((a) => a.pane_id === pending.pane_id);
    const reason = admissionProblem(pending, agent, room.members.values());
    if (reason !== null || !agent?.agent) {
      // Its "joined" notice and what it posted while waiting go nowhere. (Unless it left meanwhile.)
      if (room.store.reject(pending, reason)) {
        room.log(`✗ join rejected for @${pending.handle}: ${reason}`);
      }
      continue;
    }
    const bound = {
      terminal_id: agent.terminal_id,
      agent: agent.agent,
    };
    // Its "joined" notice and anything it posted meanwhile were queued already, and go out now.
    if (room.store.admit(pending, bound)) {
      room.addMember({ ...pending, ...bound, status: 'active', held: null });
    }
  }
}
