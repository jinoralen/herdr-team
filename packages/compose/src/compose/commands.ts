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
import { Hub } from './hub.ts';
import { isCallerMember, prepareLead, type UpResult } from './lead.ts';
import { deploymentName, loadPlan, type ManifestPlan } from './manifest.ts';
import {
  cleanupTabs,
  createAgent,
  dropPlaceholder,
  newTab,
  paneFor,
  type Runtime,
  removeAgent,
  save,
} from './resources.ts';

// Linux caps one argv entry at 128 KiB; reserve space for the member guide.
const MAX_HELPER_CONTEXT_BYTES = 80_000;

type Options = { file: string; herdr: LayoutHerdr; env?: NodeJS.ProcessEnv };

export async function up({
  file,
  herdr,
  env = process.env,
  interactive = true,
}: Options & { interactive?: boolean }): Promise<UpResult> {
  const { pane, workspace } = requirePaneContext(env);
  const root = rootDir(env);
  const hub = new Hub(env);
  hub.check();
  const current = await callerAgent(herdr, hub, pane);
  return withDeploymentLock(root, async () => {
    const member = hub.memberByPane(pane);
    const joined = isCallerMember(member, current);
    const leadHandle = joined && member ? member.handle : 'lead';
    const plan = await loadPlan(file, leadHandle);
    const states = deployments(root, workspace);
    assertUnmanagedCaller(states, pane, current);
    const lead = prepareLead({ plan, file, hub, pane, current, leadHandle, interactive });
    const state = states.find((s) => s.name === plan.name) ?? {
      room: workspace,
      name: plan.name,
      agents: {},
      tabs: {},
      retired: [],
      allocations: [],
    };
    const r: Runtime = { hub, root, state, herdr, lines: [] };
    preflight(r, plan, states);
    await recoverAllocations(r);
    await reconcile(r, plan);
    const summary = sanitizeForTerminal(
      r.lines.join('\n') || `Deployment ${plan.name} is unchanged.`,
    );
    return { output: `${summary}\n\n${lead.output}`, launch: lead.launch };
  });
}

async function callerAgent(herdr: LayoutHerdr, hub: Hub, pane: string): Promise<Agent | null> {
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
    throw new Error(
      'This caller is a managed helper. Run up or down from the user-owned lead pane.',
    );
  }
}

function preflight(r: Runtime, plan: ManifestPlan, states: Deployment[]): void {
  for (const desired of Object.values(plan.agents)) {
    const owner = states.find(
      (s) =>
        s.name !== plan.name && Object.values(s.agents).some((a) => a.handle === desired.handle),
    );
    // Ownership follows the recorded handle, even when its desired helper key changes.
    // Unique desired handles ensure its previous helper is retired before recreation.
    const old = Object.values(r.state.agents).find((agent) => agent.handle === desired.handle);
    const member = r.hub.member(desired.handle);
    const ours =
      old?.handle === desired.handle &&
      (old.joinedAt === member?.joined_at || member?.terminal_id === old.terminal);
    if (
      owner ||
      (member && !ours && (['pending', 'active'].includes(member.status) || member.queuedFrom))
    ) {
      throw new Error(
        `Handle @${desired.handle} is occupied; choose another handle before running up.`,
      );
    }
    // Linux caps one argv entry at 128 KiB. Leave room for the member guide around the purpose.
    if (Buffer.byteLength(desired.prompt) > MAX_HELPER_CONTEXT_BYTES) {
      throw new Error(`Context for @${desired.handle} exceeds 80 KB; use smaller shared files.`);
    }
  }
}

async function reconcile(r: Runtime, plan: ManifestPlan): Promise<void> {
  for (const key of Object.keys(r.state.agents)) {
    if (!(await keepAgent(r, key, plan))) {
      await removeAgent(r, key);
    }
  }
  for (const key of Object.keys(r.state.tabs)) {
    if (!Object.values(plan.agents).some((a) => a.tab === key)) {
      await retireTab(r, key);
    }
  }
  for (const [key, spec] of Object.entries(plan.tabs)) {
    const order = Object.keys(plan.agents).filter((a) => plan.agents[a]?.tab === key);
    if (!order.length) {
      continue;
    }
    await arrangeTab(r, plan, key, spec.layout, order);
  }
  await cleanupTabs(r);
  save(r);
}

async function keepAgent(r: Runtime, key: string, plan: ManifestPlan): Promise<boolean> {
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
    anchor = await placeAgent(r, plan, agentKey, tab, anchor);
  }
}

function needsTab(
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

async function placeAgent(
  r: Runtime,
  plan: ManifestPlan,
  key: string,
  tab: ManagedTab,
  anchor: string | null,
): Promise<string | null> {
  const desired = plan.agents[key];
  if (!desired) {
    return anchor;
  }
  const old = r.state.agents[key];
  const live = old ? paneFor(await r.herdr.listPaneTopology(), old) : null;
  if (!live) {
    return createAgent(r, key, desired, tab, anchor);
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

export async function down({ file, herdr, env = process.env }: Options): Promise<string> {
  const { pane, workspace } = requirePaneContext(env);
  const name = await deploymentName(file);
  const root = rootDir(env);
  const hub = new Hub(env);
  return withDeploymentLock(root, async () => {
    const states = deployments(root, workspace);
    assertUnmanagedCaller(states, pane, await callerAgent(herdr, hub, pane));
    const state = states.find((s) => s.name === name);
    if (!state) {
      return `Deployment ${name} is already down.`;
    }
    const r: Runtime = { hub, root, state, herdr, lines: [] };
    await recoverAllocations(r);
    for (const key of Object.keys(state.agents)) {
      await removeAgent(r, key);
    }
    for (const key of Object.keys(state.tabs)) {
      await retireTab(r, key);
    }
    await cleanupTabs(r);
    deleteDeployment(root, state);
    return sanitizeForTerminal(`Deployment ${name} is down.\n${r.lines.join('\n')}`);
  });
}
