// What up will do: which helpers it keeps, which tabs it lays out again, and the list of changes
// that `up --dry-run` prints. Reconcile makes its choices with the same checks.

import type { Pane } from '@herdr/herdr';
import type { Deployment, ManagedAgent, ManagedTab } from '#store';
import type { UpResult } from './lead.ts';
import type { ManifestPlan, Parts } from './manifest.ts';
import { type Change, paneFor, type Runtime, save } from './resources.ts';

// A helper is kept while its configuration is unchanged and its conversation is still the one
// compose started: same agent session, membership and live pane.
export async function keepAgent(r: Runtime, key: string, plan: ManifestPlan): Promise<boolean> {
  const old = r.state.agents[key];
  const desired = plan.agents[key];
  if (!old || !desired || old.fingerprint !== desired.fingerprint || old.phase !== 'ready') {
    return false;
  }
  const agents = await r.herdr.listPanes();
  const panes = await r.herdr.listPaneTopology();
  const member = r.hub.member(old.handle);
  const live = agents.find((a) => a.terminal_id === old.terminal);
  if (old.session && live?.agent_session?.value && old.session !== live.agent_session.value) {
    return false;
  }
  if (!old.session && live?.agent_session?.value) {
    old.session = live.agent_session.value;
    save(r);
  }
  return !!(
    member?.joined_at === old.joinedAt &&
    ['active', 'pending'].includes(member.status) &&
    live?.agent === desired.kind &&
    paneFor(panes, old)
  );
}

export function needsTab(
  tab: ManagedTab | undefined,
  panes: Pane[],
  layout: string,
  order: string[],
  state: Deployment,
): boolean {
  if (!tab || tab.layout !== layout || JSON.stringify(tab.order) !== JSON.stringify(order)) {
    return true;
  }
  const present = panes.some((p) => p.tab_id === tab.id);
  const missing = order.some((a) => !state.agents[a]);
  const outside = order.some((a) => {
    const live = panes.find((p) => p.terminal_id === state.agents[a]?.terminal);
    return !!live && live.tab_id !== tab.id;
  });
  return !present || (!tab.root && missing) || outside;
}

// The changes up makes, in its order, worked out without changing anything.
export async function planChanges(r: Runtime, plan: ManifestPlan): Promise<Change[]> {
  const dry = { ...r, dry: true };
  const recover: Change[] = r.state.allocations.length
    ? [{ action: 'recover', allocations: r.state.allocations.length }]
    : [];
  const { changes, kept } = await agentChanges(dry, plan);
  const closed: Change[] = Object.keys(r.state.tabs)
    .filter((key) => !Object.values(plan.agents).some((a) => a.tab === key))
    .map((tab) => ({ action: 'close-tab', tab }));
  return [...recover, ...changes, ...closed, ...(await tabChanges(dry, plan, kept))];
}

// Recorded helpers: removed, kept or replaced.
async function agentChanges(
  r: Runtime,
  plan: ManifestPlan,
): Promise<{ changes: Change[]; kept: Set<string> }> {
  const changes: Change[] = [];
  const kept = new Set<string>();
  for (const [key, old] of Object.entries(r.state.agents)) {
    const desired = plan.agents[key];
    if (!desired) {
      changes.push({ action: 'remove', agent: key, handle: old.handle });
    } else if (await keepAgent(r, key, plan)) {
      kept.add(key);
    } else {
      const reasons = replaceReasons(old, desired.parts, desired.fingerprint);
      changes.push({ action: 'replace', agent: key, handle: desired.handle, reasons });
    }
  }
  return { changes, kept };
}

// Each tab in use: laid out again or not, then its helpers started or moved into it.
async function tabChanges(r: Runtime, plan: ManifestPlan, kept: Set<string>): Promise<Change[]> {
  const panes = await r.herdr.listPaneTopology();
  return Object.entries(plan.tabs).flatMap(([tab, spec]): Change[] => {
    const order = Object.keys(plan.agents).filter((a) => plan.agents[a]?.tab === tab);
    if (!order.length) {
      return [];
    }
    const recorded = Object.hasOwn(r.state.tabs, tab) ? r.state.tabs[tab] : undefined;
    const rebuilt = needsTab(recorded, panes, spec.layout, order, r.state);
    const placed = order.flatMap((key) =>
      placement({ r, plan, key, tab, panes, kept, moved: rebuilt ? null : recorded?.id }),
    );
    return rebuilt ? [{ action: 'arrange-tab', tab }, ...placed] : placed;
  });
}

// A helper in its tab: started if compose has none, moved if a kept one is elsewhere. moved: the
// tab it may stay in, or null when the tab is laid out again and every kept helper moves.
function placement({
  r,
  plan,
  key,
  tab,
  panes,
  kept,
  moved,
}: {
  r: Runtime;
  plan: ManifestPlan;
  key: string;
  tab: string;
  panes: Pane[];
  kept: Set<string>;
  moved: string | null | undefined;
}): Change[] {
  const handle = plan.agents[key]?.handle;
  const old = r.state.agents[key];
  if (!old) {
    return [{ action: 'start', agent: key, handle, tab }];
  }
  const live = kept.has(key) ? paneFor(panes, old) : null;
  return live && live.tab_id !== moved ? [{ action: 'move', agent: key, handle, tab }] : [];
}

const PART_NAMES: Record<keyof Parts, string> = {
  definition: 'its definition',
  handle: 'its handle',
  cwd: 'its working folder',
  purpose: 'its prompt',
  context: "the team's shared prompt, files or lead",
};

// Why a recorded helper isn't kept: what changed, or, when nothing did, its conversation.
function replaceReasons(old: ManagedAgent, parts: Parts, fingerprint: string): string[] {
  if (old.fingerprint === fingerprint) {
    return [old.phase === 'ready' ? 'its conversation is gone' : 'its startup did not finish'];
  }
  if (!old.parts) {
    return ['its configuration changed'];
  }
  return (Object.keys(PART_NAMES) as (keyof Parts)[])
    .filter((part) => old.parts?.[part] !== parts[part])
    .map((part) => `${PART_NAMES[part]} changed`);
}

const DESCRIBE: Record<Change['action'], (c: Change) => string> = {
  recover: (c: Change): string => `Recover ${c.allocations} unfinished pane allocation(s).`,
  remove: (c: Change): string => `Close @${c.handle} (${c.agent}): it is no longer in the team.`,
  replace: (c: Change): string => `Replace @${c.handle} (${c.agent}): ${c.reasons?.join(', ')}.`,
  'close-tab': (c: Change): string => `Close tab ${c.tab}.`,
  'arrange-tab': (c: Change): string => `Lay out tab ${c.tab} in a new tab.`,
  start: (c: Change): string => `Start @${c.handle} (${c.agent}) in tab ${c.tab}.`,
  move: (c: Change): string => `Move @${c.handle} (${c.agent}) to tab ${c.tab}.`,
};

export function dryRunText(name: string, changes: Change[], launch: UpResult['launch']): string {
  const lines = changes.map((c) => DESCRIBE[c.action](c));
  if (launch) {
    lines.push(`Start the ${launch.kind} lead in this pane.`);
  }
  return [
    `Dry run of ${name}; nothing was changed.`,
    ...(lines.length ? lines : [`Deployment ${name} is unchanged.`]),
  ].join('\n');
}
