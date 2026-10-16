// The router's decisions, as plain functions of what it knows: why a delivery waits, whether a join
// is admitted, whether a stored member is still there.

import type { Agent } from '#herdr';
import type { Member } from '#store';

const READY = new Set(['idle', 'done']);

// Why a woken member's messages can't be delivered right now, or null if they can.
// live: the member's agent in this tick's `herdr agent list`, null if Herdr hasn't recognized it.
export function heldReason(live: Agent | null): string | null {
  if (!live) {
    return 'Herdr has not recognized its agent yet';
  }
  if (live.agent_status === 'blocked') {
    return 'waiting on an approval/question in its pane';
  }
  if (!READY.has(live.agent_status)) {
    return `it is ${live.agent_status}`;
  }
  if (live.interactive_ready === false) {
    return 'its input is not ready';
  }
  return null;
}

// Why a pending join is refused, or null to admit it. agent: what Herdr sees in its pane.
export function admissionProblem(
  pending: Member,
  agent: Agent | undefined,
  members: Iterable<Member>,
): string | null {
  if (!agent?.agent) {
    return `Herdr does not see a recognized agent in pane ${pending.pane_id}.`;
  }
  const dup = [...members].find((m) => m.terminal_id === agent.terminal_id);
  return dup ? `This agent already joined as @${dup.handle}.` : null;
}

// The agent a stored member is still running as, found by its terminal; undefined if the terminal
// is gone, or now runs a different agent or a new session of it (then the member has left).
export function stillThere(stored: Member, agents: Agent[]): Agent | undefined {
  const live = agents.find((a) => a.terminal_id === stored.terminal_id);
  if (!live || (live.agent && live.agent !== stored.agent)) {
    return undefined;
  }
  const session = live.agent_session?.value;
  if (session && stored.session && session !== stored.session) {
    return undefined;
  }
  return live;
}
