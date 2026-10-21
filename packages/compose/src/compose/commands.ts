// Reconcile desired agents and live terminals through up/down; ownership is scoped to a room/name.

import { type Agent, type LayoutHerdr, type Pane, requirePaneContext } from '@herdr/herdr';
import { sanitizeForTerminal } from '@herdr/terminal';
import {
  type Deployment,
  deleteDeployment,
  deployments,
  type ManagedTab,
  rootDir,
  withDeploymentLock,
} from '#store';
import { recoverAllocations } from './allocation.ts';
import { COMPOSE_SELF, Hub, type HubClient, isJoinOf } from './hub.ts';
import { deploymentName, loadPlan, type ManifestPlan, resolveTeam } from './manifest.ts';
import { dryRunText, needsTab, planChanges } from './plan.ts';
import {
  type Change,
  cleanupTabs,
  dropPlaceholder,
  newTab,
  type Placed,
  paneFor,
  placeNewAgent,
  type Runtime,
  removeAgent,
  save,
  startAgents,
} from './resources.ts';
import { RetryLater } from './retry.ts';

// Linux caps one argv entry at 128 KiB; reserve space for the member guide.
const MAX_HELPER_CONTEXT_BYTES = 80_000;

// file: a team name (teams/<name>.yaml in the herdr-team folder) or a path. Without it, up reads
// herdr-team.yaml in the current folder, and down takes the workspace's only deployment. hub:
// hub's command line unless given, as Herdr is.
type Options = { file?: string; herdr: LayoutHerdr; hub?: HubClient; env?: NodeJS.ProcessEnv };

type UpResult = { output: string; changes: Change[]; deployment: string };

export async function up({
  file: team,
  herdr,
  env = process.env,
  hub = new Hub(env),
  cwd = process.cwd(),
  dryRun = false,
}: Options & { cwd?: string; dryRun?: boolean }): Promise<UpResult> {
  const { pane, workspace } = requirePaneContext(env);
  const file = resolveTeam(team, env, cwd);
  const root = rootDir(env);
  hub.check();
  const current = await callerAgent(herdr, hub, pane);
  return withDeploymentLock(root, async () => {
    // Another up or down may have changed membership while this one waited for the lock.
    hub.refresh();
    const plan = await loadPlan(file, env);
    const states = deployments(root, workspace);
    assertUnmanagedCaller(states, pane, current);
    const state = states.find((s) => s.name === plan.name) ?? {
      room: workspace,
      name: plan.name,
      agents: {},
      tabs: {},
      retired: [],
      allocations: [],
    };
    const r: Runtime = { hub, root, state, herdr, lines: [], dry: dryRun };
    await preflight(r, plan, states);
    const { changes, kept } = await planChanges(r, plan);
    if (dryRun) {
      return {
        output: sanitizeForTerminal(dryRunText(plan.name, changes)),
        changes,
        deployment: plan.name,
      };
    }
    await recoverAllocations(r);
    await reconcile(r, plan, kept);
    const summary = sanitizeForTerminal(
      r.lines.join('\n') || `Deployment ${plan.name} is unchanged.`,
    );
    return {
      output: summary,
      changes,
      deployment: plan.name,
    };
  });
}

async function callerAgent(
  herdr: LayoutHerdr,
  hub: HubClient,
  pane: string,
): Promise<Agent | null> {
  const terminal = hub.memberByPane(pane)?.terminal_id;
  if (terminal) {
    const moved = (await herdr.listPanes()).find((a) => a.terminal_id === terminal);
    if (moved) {
      return moved;
    }
  }
  return herdr.pane(pane);
}

function assertUnmanagedCaller(states: Deployment[], pane: string, current: Agent | null): void {
  const managed = states.some((s) =>
    Object.values(s.agents).some((a) => a.pane === pane || a.terminal === current?.terminal_id),
  );
  if (managed) {
    throw new Error('This caller is a managed agent. Run up or down from a separate control pane.');
  }
}

async function preflight(r: Runtime, plan: ManifestPlan, states: Deployment[]): Promise<void> {
  const panes = new Set((await r.herdr.listPaneTopology()).map((p) => p.pane_id));
  for (const desired of Object.values(plan.agents)) {
    checkHandle(r, plan, states, desired.handle, panes);
    // Linux caps one argv entry at 128 KiB. Leave room for the member guide around the purpose.
    if (Buffer.byteLength(desired.prompt) > MAX_HELPER_CONTEXT_BYTES) {
      throw new Error(`Context for @${desired.handle} exceeds 80 KB; use smaller shared files.`);
    }
  }
}

// A helper's handle is free for this deployment: no other deployment owns it, and no member
// compose didn't start holds it. Waiting frees it when that member's pane has closed (the next
// tick retires it) or it only has posts left to deliver. panes: the live pane IDs.
function checkHandle(
  r: Runtime,
  plan: ManifestPlan,
  states: Deployment[],
  handle: string,
  panes: Set<string>,
): void {
  const owner = states.find(
    (s) => s.name !== plan.name && Object.values(s.agents).some((a) => a.handle === handle),
  );
  // Ownership follows the recorded handle, even when its desired helper key changes.
  // Unique desired handles ensure its previous helper is retired before recreation.
  const old = Object.values(r.state.agents).find((agent) => agent.handle === handle);
  const member = r.hub.member(handle);
  const ours = !!old && !!member && isJoinOf(member, old);
  const foreign = member && !ours ? member : null;
  const holds = !!foreign && ['pending', 'active'].includes(foreign.status);
  if (owner || (holds && panes.has(foreign.pane_id))) {
    throw new Error(`Handle @${handle} is occupied; choose another handle before running up.`);
  }
  if (holds) {
    throw new RetryLater(
      `Handle @${handle} belongs to a member whose pane has closed. Retry ${COMPOSE_SELF} up once a tick has retired it.`,
    );
  }
  if (foreign?.queuedFrom) {
    throw new RetryLater(
      `Handle @${handle} still has undelivered posts from its previous member. Retry ${COMPOSE_SELF} up once a tick has delivered them.`,
    );
  }
}

// kept: the recorded helpers the plan keeps; every other one is removed. The plan was read before
// recovery and seconds of Herdr calls, so a tick may have retired a kept helper since: its
// membership is read again (from hub only), and a helper that is no longer the same join is replaced.
async function reconcile(r: Runtime, plan: ManifestPlan, kept: Set<string>): Promise<void> {
  r.hub.refresh();
  const members = r.hub.members();
  const stillKept = (key: string): boolean => {
    const old = r.state.agents[key];
    const member = old && members.find((m) => m.handle === old.handle);
    return (
      kept.has(key) &&
      !!member &&
      member.joined_at === old.joinedAt &&
      ['active', 'pending'].includes(member.status)
    );
  };
  for (const key of Object.keys(r.state.agents)) {
    if (!stillKept(key)) {
      await removeAgent(r, key);
    }
  }
  for (const key of Object.keys(r.state.tabs)) {
    if (!Object.values(plan.agents).some((a) => a.tab === key)) {
      await retireTab(r, key);
    }
  }
  // Every pane is laid out first; then the new helpers start together.
  const placed: Placed[] = [];
  for (const [key, spec] of Object.entries(plan.tabs)) {
    const order = Object.keys(plan.agents).filter((a) => plan.agents[a]?.tab === key);
    if (!order.length) {
      continue;
    }
    await arrangeTab(r, plan, key, spec.layout, order, placed);
  }
  await startAgents(r, placed);
  await cleanupTabs(r);
  save(r);
}

async function retireTab(r: Runtime, key: string): Promise<void> {
  const tab = r.state.tabs[key];
  if (!tab) {
    return;
  }
  if (tab.root) {
    const root = (await r.herdr.listPaneTopology()).find((p) => p.pane_id === tab.root);
    if (root) {
      await r.herdr.closePane(root.pane_id);
    }
  }
  r.state.retired.push({ id: tab.id, root: null });
  delete r.state.tabs[key];
  save(r);
}

async function arrangeTab(
  r: Runtime,
  plan: ManifestPlan,
  key: string,
  layout: 'rows' | 'columns',
  order: string[],
  placed: Placed[],
): Promise<void> {
  const first = plan.agents[order[0] ?? ''];
  if (!first) {
    return;
  }
  let tab = Object.hasOwn(r.state.tabs, key) ? r.state.tabs[key] : undefined;
  const panes = await r.herdr.listPaneTopology();
  if (needsTab(tab, panes, layout, order, r.state)) {
    tab = await newTab(r, key, layout, order, first.cwd);
  }
  if (!tab) {
    throw new Error('The managed tab could not be created.');
  }
  await r.herdr.renameTab(tab.id, `${r.state.name}:${key}`);
  let anchor: string | null = null;
  for (const agentKey of order) {
    anchor = await placeAgent(r, plan, agentKey, tab, anchor, placed);
  }
}

async function placeAgent(
  r: Runtime,
  plan: ManifestPlan,
  key: string,
  tab: ManagedTab,
  anchor: string | null,
  placed: Placed[],
): Promise<string | null> {
  const desired = plan.agents[key];
  if (!desired) {
    return anchor;
  }
  const old = r.state.agents[key];
  const live = old ? paneFor(await r.herdr.listPaneTopology(), old) : null;
  if (!live) {
    const created = await placeNewAgent(r, key, desired, tab, anchor);
    placed.push(created);
    return created.pane;
  }
  await moveToTab(r, live, tab.id, anchor ?? tab.root, tab.layout);
  const pane =
    (await r.herdr.listPaneTopology()).find((p) => p.terminal_id === live.terminal_id)?.pane_id ??
    live.pane_id;
  await dropPlaceholder(r, tab);
  return pane;
}

async function moveToTab(
  r: Runtime,
  pane: Pane,
  tab: string,
  target: string | null,
  layout: 'rows' | 'columns',
): Promise<void> {
  if (pane.tab_id === tab) {
    return;
  }
  if (!target) {
    throw new Error('The destination tab has no anchor pane; retry up.');
  }
  await r.herdr.movePane(pane.pane_id, {
    tab,
    target,
    direction: layout === 'columns' ? 'right' : 'down',
  });
  r.lines.push(`Moved pane ${pane.pane_id}.`);
}

// json: the outcome as JSON: the deployment taken down (null if none) and the handles removed.
export async function down({
  file,
  herdr,
  env = process.env,
  hub = new Hub(env),
  json = false,
}: Options & { json?: boolean }): Promise<string> {
  const { pane, workspace } = requirePaneContext(env);
  const name = file === undefined ? undefined : await deploymentName(resolveTeam(file, env));
  const root = rootDir(env);
  const outcome = await withDeploymentLock(root, async (): Promise<DownOutcome> => {
    const states = deployments(root, workspace);
    assertUnmanagedCaller(states, pane, await callerAgent(herdr, hub, pane));
    const state =
      name === undefined ? onlyDeployment(states) : (states.find((s) => s.name === name) ?? null);
    if (!state) {
      return name === undefined
        ? { deployment: null, removed: [], text: 'No deployments in this workspace.' }
        : { deployment: name, removed: [], text: `Deployment ${name} is already down.` };
    }
    const removed = Object.values(state.agents).map((a) => a.handle);
    const r: Runtime = { hub, root, state, herdr, lines: [] };
    await tearDown(r);
    return {
      deployment: state.name,
      removed,
      text: sanitizeForTerminal(`Deployment ${state.name} is down.\n${r.lines.join('\n')}`),
    };
  });
  const { text, ...result } = outcome;
  return json ? JSON.stringify(result) : text;
}

type DownOutcome = { deployment: string | null; removed: string[]; text: string };

// Close every helper and tab the deployment owns, then forget it.
async function tearDown(r: Runtime): Promise<void> {
  await recoverAllocations(r);
  for (const key of Object.keys(r.state.agents)) {
    await removeAgent(r, key);
  }
  for (const key of Object.keys(r.state.tabs)) {
    await retireTab(r, key);
  }
  await cleanupTabs(r);
  deleteDeployment(r.root, r.state);
}

// down without a team: the workspace's only deployment, or none; it can't guess between several.
function onlyDeployment(states: Deployment[]): Deployment | null {
  if (states.length > 1) {
    throw new Error(
      `This workspace has ${states.length} deployments: ${states.map((s) => s.name).join(', ')}. Name the one to take down.`,
    );
  }
  return states[0] ?? null;
}
