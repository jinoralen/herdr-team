// Who is in a room, checked against Herdr at the start of each pass: stored members are followed to
// their terminals, and pending joins are admitted or refused. Like delivery.ts, these take the room.

import type { Agent } from '#herdr';
import type { Member } from '#store';
import type { Router } from './router.ts';
import { admissionProblem, stillThere } from './rules.ts';

// Follows each stored member to its terminal. A member whose terminal is gone, or runs a different
// agent now, leaves the room; one Herdr hasn't recognized yet (e.g. just after Herdr restarted)
// stays, and gets nothing until it is recognized. A moved pane has a new id in `live`; deliveries
// go there.
export function restoreMembers(room: Router, agents: Agent[]): void {
  const gone: Member[] = [];
  for (const stored of room.store.members('active')) {
    const live = stillThere(stored, agents);
    if (live) {
      room.addRuntime(withSession(room, stored, live), live.agent ? live : null);
    } else {
      gone.push(stored);
    }
  }
  for (const stored of gone) {
    room.removeMember(
      stored,
      'gone',
      'left: pane closed, or a different agent or new session is running there',
    );
  }
}

// Herdr may report an agent's session only some time after detecting it: recorded once it does.
function withSession(room: Router, stored: Member, live: Agent): Member {
  const session = live.agent_session?.value;
  if (stored.session || !session) {
    return stored;
  }
  room.store.setSession(stored, session);
  return { ...stored, session };
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
      session: agent.agent_session?.value ?? null,
    };
    // Its "joined" notice and anything it posted meanwhile were queued already, and go out now.
    if (room.store.admit(pending, bound)) {
      room.addRuntime({ ...pending, ...bound, status: 'active', held: null }, agent);
    }
  }
}
