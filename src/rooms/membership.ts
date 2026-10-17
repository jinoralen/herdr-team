// Who is in a room, checked against Herdr at the start of each pass: stored members are followed to
// their terminals, and pending joins are admitted or refused. Like delivery.ts, these take the room.

import type { Agent } from '#herdr';
import type { Member } from '#store';
import type { Router } from './router.ts';
import { admissionProblem, stillThere } from './rules.ts';

// Membership belongs to the pane, across agent replacements and sessions.
// Terminal IDs let deliveries follow panes moved to a different workspace.
export function restoreMembers(room: Router, agents: Agent[]): void {
  const gone: Member[] = [];
  for (const stored of room.store.members('active')) {
    const live = stillThere(stored, agents);
    if (live) {
      room.addRuntime(stored, live);
    } else {
      gone.push(stored);
    }
  }
  for (const stored of gone) {
    room.removeMember(stored, 'gone', 'left: pane closed');
  }
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
      room.addRuntime({ ...pending, ...bound, status: 'active', held: null }, agent);
    }
  }
}
