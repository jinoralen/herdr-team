// Allocate through uniquely labelled tabs so a lost creation response can be recovered on retry.
// Agent panes are then moved into the desired tab; no unlabelled split is ever allocated.
import type { NewTab } from '@herdr/herdr';
import { type Runtime, save } from './resources.ts';

export async function allocate(r: Runtime, cwd: string): Promise<NewTab> {
  const intent = {
    label: `hub-${crypto.randomUUID()}`,
    pane: null as string | null,
    tab: null as string | null,
  };
  r.state.allocations.push(intent);
  save(r);
  const created = await r.herdr.createTab({ workspace: r.state.room, cwd, label: intent.label });
  intent.pane = created.pane;
  intent.tab = created.tab;
  save(r);
  return created;
}

// Consuming allocation ownership and saving its final owner is one atomic journal update.
export function consume(r: Runtime, pane: string): void {
  r.state.allocations = r.state.allocations.filter((a) => a.pane !== pane);
  save(r);
}

export async function recoverAllocations(r: Runtime): Promise<void> {
  for (const allocation of [...r.state.allocations]) {
    await recoverAllocation(r, allocation);
  }
}

async function recoverAllocation(
  r: Runtime,
  allocation: Runtime['state']['allocations'][number],
): Promise<void> {
  const original = allocation.pane ?? (await identifyAllocation(r, allocation));
  // Recorded IDs survive moves between tabs; the original tab is no longer authoritative.
  const panes = await r.herdr.listPaneTopology();
  if (panes.some((p) => p.pane_id === original)) {
    await r.herdr.closePane(original);
  }
  r.state.allocations = r.state.allocations.filter((a) => a.label !== allocation.label);
  save(r);
}

async function identifyAllocation(
  r: Runtime,
  allocation: Runtime['state']['allocations'][number],
): Promise<string> {
  const tabs = await r.herdr.listTabs();
  const tab =
    allocation.tab ??
    tabs.find((t) => t.workspace_id === r.state.room && t.label === allocation.label)?.tab_id;
  const panes = (await r.herdr.listPaneTopology()).filter((p) => p.tab_id === tab);
  const original = panes[0];
  if (!original || panes.length !== 1) {
    throw new Error(
      `Cannot identify unfinished allocation ${allocation.label}: its labelled tab must contain exactly one pane. Ownership was retained; inspect Herdr before retrying.`,
    );
  }
  return original.pane_id;
}
