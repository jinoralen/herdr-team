// Resource operations journal ownership before starting agents and retain it until cleanup succeeds.

import type { LayoutHerdr, Pane } from '@herdr/herdr';
import { type Deployment, type ManagedAgent, type ManagedTab, saveDeployment } from '#store';
import { allocate, consume } from './allocation.ts';
import { COMPOSE_SELF, type HubClient } from './hub.ts';
import type { DesiredAgent } from './manifest.ts';
import { RetryLater } from './retry.ts';

export type Runtime = {
  hub: HubClient;
  root: string;
  state: Deployment;
  herdr: LayoutHerdr;
  lines: string[];
  // A dry run reads and plans; nothing it changes in memory is saved.
  dry?: boolean;
};
// A helper by its key in the team file and its handle.
type Helper = { agent: string; handle: string };
// What up changes, or would change with --dry-run: in the order it happens.
export type Change =
  | { action: 'recover'; allocations: number }
  | ({ action: 'remove' } & Helper)
  // reasons: what changed, or that its conversation is gone.
  | ({ action: 'replace'; reasons: string[] } & Helper)
  | ({ action: 'start' | 'move'; tab: string } & Helper)
  | { action: 'arrange-tab' | 'close-tab'; tab: string };

export const save = (r: Runtime): void => {
  if (!r.dry) {
    saveDeployment(r.root, r.state);
  }
};
export const paneFor = (panes: Pane[], a: ManagedAgent): Pane | null =>
  panes.find((p) => p.terminal_id === a.terminal) ?? null;

export async function removeAgent(r: Runtime, key: string): Promise<void> {
  const a = r.state.agents[key];
  if (!a) {
    return;
  }
  const pane = paneFor(await r.herdr.listPaneTopology(), a);
  if (pane) {
    await r.herdr.closePane(pane.pane_id);
  }
  delete r.state.agents[key];
  save(r);
  r.lines.push(`Removed @${a.handle}.`);
}

export async function newTab(
  r: Runtime,
  key: string,
  layout: 'rows' | 'columns',
  order: string[],
  cwd: string,
): Promise<ManagedTab> {
  const old = Object.hasOwn(r.state.tabs, key) ? r.state.tabs[key] : undefined;
  if (old) {
    r.state.retired.push({ id: old.id, root: old.root });
  }
  // Save the old ownership before making a new remote resource.
  save(r);
  const created = await allocate(r, cwd);
  const tab: ManagedTab = { id: created.tab, root: created.pane, layout, order };
  r.state.tabs[key] = tab;
  consume(r, created.pane);
  return tab;
}

// The tab's root placeholder is done once a real agent pane is in the tab.
export async function dropPlaceholder(r: Runtime, tab: ManagedTab): Promise<void> {
  if (!tab.root) {
    return;
  }
  const placeholder = (await r.herdr.listPaneTopology()).find((p) => p.pane_id === tab.root);
  if (placeholder) {
    await r.herdr.closePane(placeholder.pane_id);
  }
  tab.root = null;
  save(r);
}

// A new helper whose pane is laid out, waiting for startAgents.
export type Placed = { key: string; desired: DesiredAgent; pane: string };

// Lays out a new helper's pane in its tab. Starting it is left to startAgents, so every helper's
// pane is in place before any agent boots.
export async function placeNewAgent(
  r: Runtime,
  key: string,
  desired: DesiredAgent,
  tab: ManagedTab,
  anchor: string | null,
): Promise<Placed> {
  requireFreeHandle(r, desired.handle);
  const created = await allocate(r, desired.cwd);
  const pane = created.pane;
  const live = (await r.herdr.listPaneTopology()).find((p) => p.pane_id === pane);
  if (!live) {
    throw new Error(`New pane ${pane} disappeared; retry up.`);
  }
  const a: ManagedAgent = {
    handle: desired.handle,
    fingerprint: desired.fingerprint,
    parts: desired.parts,
    pane,
    terminal: live.terminal_id,
    joinedAt: null,
    session: null,
    phase: 'created',
  };
  r.state.agents[key] = a;
  consume(r, pane);
  const target = anchor ?? tab.root;
  if (!target) {
    throw new Error('The managed tab has no anchor; retry up.');
  }
  await r.herdr.movePane(pane, {
    tab: tab.id,
    target,
    direction: tab.layout === 'columns' ? 'right' : 'down',
  });
  await dropPlaceholder(r, tab);
  const current = paneFor(await r.herdr.listPaneTopology(), a);
  if (!current) {
    throw new Error(`Managed pane ${pane} disappeared after moving; retry up.`);
  }
  return { key, desired, pane: current.pane_id };
}

// Starts the placed helpers together: each one waits seconds for its agent to boot and take the
// guide, so one at a time would add those waits up. Each start is journaled before it begins and
// records its own outcome, so a failed one leaves the others ready. Fails after all have settled.
export async function startAgents(r: Runtime, placed: Placed[]): Promise<void> {
  const results = await Promise.allSettled(placed.map((p) => startAgent(r, p)));
  const errors: Error[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      r.lines.push(`Created @${placed[i]?.desired.handle}.`);
    } else {
      errors.push(result.reason as Error);
    }
  });
  const [first] = errors;
  if (errors.length === 1 && first) {
    throw first;
  }
  if (errors.length) {
    const message = errors.map((e) => e.message).join('\n');
    throw errors.every((e) => e instanceof RetryLater)
      ? new RetryLater(message)
      : new Error(message);
  }
}

async function startAgent(r: Runtime, { key, desired, pane }: Placed): Promise<void> {
  const a = r.state.agents[key];
  if (!a) {
    throw new Error(`@${desired.handle} is no longer recorded; retry up.`);
  }
  // Startup or prompt failures can be uncertain. A retry replaces this owned pane.
  a.phase = 'started';
  save(r);
  await r.hub.start(desired, pane);
  const member = r.hub.member(desired.handle);
  if (!member || member.pane_id !== pane || member.status !== 'active') {
    throw new Error(
      `Membership of @${desired.handle} changed during startup. Inspect hub status before retrying.`,
    );
  }
  a.joinedAt = member.joined_at;
  a.session = (await r.herdr.pane(pane))?.agent_session?.value ?? null;
  a.phase = 'ready';
  save(r);
}

export async function cleanupTabs(r: Runtime): Promise<void> {
  for (const retired of [...r.state.retired]) {
    let panes = (await r.herdr.listPaneTopology()).filter((p) => p.tab_id === retired.id);
    if (retired.root && panes.some((p) => p.pane_id === retired.root)) {
      await r.herdr.closePane(retired.root);
      panes = (await r.herdr.listPaneTopology()).filter((p) => p.tab_id === retired.id);
    }
    if (panes.length) {
      r.lines.push(`Kept tab ${retired.id}: it contains panes outside this deployment.`);
    }
    r.state.retired = r.state.retired.filter((t) => t.id !== retired.id);
    save(r);
  }
}

function requireFreeHandle(r: Runtime, handle: string): void {
  const occupied = r.hub.member(handle);
  if (occupied && (['pending', 'active'].includes(occupied.status) || occupied.queuedFrom)) {
    throw new RetryLater(
      `Handle @${handle} is still occupied or draining outgoing messages. Retry ${COMPOSE_SELF} up once a tick has retired its member and delivered its posts.`,
    );
  }
}
