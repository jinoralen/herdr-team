// Recorded deployments in one workspace, with each helper's room membership as hub reports it. No
// live Herdr access: hub's status only reads its own database.

import { requirePaneContext } from '@herdr/herdr';
import { sanitizeForTerminal } from '@herdr/terminal';
import { type Deployment, deployments, type ManagedAgent, rootDir } from '#store';
import { Hub, type Membership } from './hub.ts';

type Room = Membership['status'] | 'not a member';

export function status({
  env = process.env,
  json = false,
}: {
  env?: NodeJS.ProcessEnv;
  json?: boolean;
} = {}): string {
  const { workspace } = requirePaneContext(env);
  const states = deployments(rootDir(env), workspace);
  // Ownership is compose's own record; the room is only shown when hub can be asked.
  let members: Membership[] | null = null;
  let unavailable = '';
  if (states.length) {
    try {
      members = new Hub(env).members();
    } catch (error) {
      unavailable = (error as Error).message;
    }
  }
  const room = (a: ManagedAgent): Room | null => (members ? roomState(members, a) : null);
  if (json) {
    return JSON.stringify({
      deployments: states.map((d) => ({
        name: d.name,
        agents: Object.entries(d.agents).map(([key, a]) => ({
          key,
          handle: a.handle,
          phase: a.phase,
          pane: a.pane,
          room: room(a),
        })),
      })),
      ...(unavailable && { roomUnavailable: unavailable }),
    });
  }
  const lines = states.map((d) => deploymentLine(d, room));
  if (unavailable) {
    lines.push(`Room membership is unavailable: ${unavailable}`);
  }
  return sanitizeForTerminal(lines.join('\n') || 'No deployments in this workspace.');
}

function deploymentLine(d: Deployment, room: (a: ManagedAgent) => Room | null): string {
  const agents = Object.entries(d.agents).map(([key, a]) => {
    const state = room(a);
    return `${key}=@${a.handle} (${a.phase}${state ? `; room: ${state}` : ''})`;
  });
  return `Deployment ${d.name}: ${agents.join(', ') || 'no agents'}`;
}

// The member this helper joined as: same handle, and the join or terminal compose recorded.
// Another member under the handle (after the helper left) is not it.
function roomState(members: Membership[], a: ManagedAgent): Room {
  const member = members.find(
    (m) => m.handle === a.handle && (m.joined_at === a.joinedAt || m.terminal_id === a.terminal),
  );
  return member?.status ?? 'not a member';
}
