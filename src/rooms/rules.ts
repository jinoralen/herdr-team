// The router's decisions, as plain functions of what it knows: why a delivery waits, whether a join
// is admitted, and where a stored member's pane is now.

import type { Agent } from '#herdr';
import type { Member } from '#store';

const READY = new Set(['idle', 'done']);

// Why a woken member's messages can't be delivered right now, or null if they can.
// live: the member's pane as Herdr reports it now.
export function heldReason(live: Agent): string | null {
  if (!live.agent) {
    return 'no agent is running in its pane';
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

// The member's pane in Herdr's list, whichever agent or session runs in it now (or none); undefined if
// the pane closed or moved to another workspace.
export function findPane(stored: Member, agents: Agent[]): Agent | undefined {
  return agents.find((a) => a.pane_id === stored.pane_id);
}
