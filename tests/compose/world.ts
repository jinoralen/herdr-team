// An in-memory Herdr and hub for compose's tests: compose runs against it in-process, and every
// command it sends is recorded in order, so tests compare what up and down did without starting a
// process. Hub's real behaviour is covered at the boundary by e2e.test.ts and hub-contract.test.ts.
//
// It keeps the hub rules compose depends on: invite reserves the handle, starts the agent and
// confirms the member as active before submitting the guide; a failed guide leaves the member and
// reports an uncertain startup; a tick retires members whose pane has closed.
import { onTestFinished } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HubClient, Membership } from '@herdr/compose';
import { type Agent, HerdrError, type LayoutHerdr, type NewTab, type Pane } from '@herdr/herdr';

type SimPane = Pane & Agent;
// A command that fails once, the next time it runs: a tab creation refused before anything is
// made, one whose response is lost after the tab exists, or a guide that may not have arrived.
type Failure = 'create-refused' | 'create-lost' | 'prompt';

class World implements LayoutHerdr, HubClient {
  readonly command = 'herdr-hub';
  // Every command, in order, as its words: herdr's (`pane list`) and hub's (`invite …`).
  readonly calls: string[][] = [];
  panes: SimPane[] = [
    {
      pane_id: 'lead',
      terminal_id: 'lead-terminal',
      workspace_id: 'w1',
      tab_id: 'user',
      agent: 'codex',
      agent_status: 'idle',
    },
  ];
  tabs: { tab_id: string; label: string; workspace_id: string }[] = [];
  memberships: Membership[] = [];
  // How long each agent takes to start, and the most starts that ran at once.
  startDelay = 0;
  maxStarting = 0;
  private starting = 0;
  private next = 1;
  private failures = new Set<Failure>();

  failNext(failure: Failure): void {
    this.failures.add(failure);
  }

  // The commands that change something, without the guide text: what a test compares.
  changes(): string[] {
    const reads = ['list', 'get'];
    return this.calls
      .filter((c) => !reads.includes(c[1] ?? ''))
      .map((c) => {
        // An invite by its definition's file name and without its task.
        const words =
          c[0] === 'invite'
            ? ['invite', path.basename(c[1] ?? ''), ...c.slice(2, 4), ...c.slice(6)]
            : c;
        return words.join(' ').replace(/hub-[0-9a-f-]{36}/g, 'hub-<id>');
      });
  }

  // The tasks hub was given, by handle.
  prompts(): { handle: string; pane: string; prompt: string }[] {
    return this.calls
      .filter((c) => c[0] === 'invite')
      .map((c) => ({
        handle: c[c.indexOf('--handle') + 1] ?? '',
        pane: c[c.indexOf('--pane') + 1] ?? '',
        prompt: c[c.indexOf('--prompt') + 1] ?? '',
      }));
  }

  // Herdr

  async listPanes(): Promise<Agent[]> {
    this.calls.push(['pane', 'list']);
    return structuredClone(this.panes);
  }
  async listPaneTopology(): Promise<Pane[]> {
    this.calls.push(['pane', 'list']);
    return structuredClone(this.panes);
  }
  async pane(paneId: string): Promise<Agent | null> {
    this.calls.push(['pane', 'get', paneId]);
    return structuredClone(this.panes.find((p) => p.pane_id === paneId) ?? null);
  }
  async listTabs(): Promise<{ tab_id: string; label?: string; workspace_id: string }[]> {
    this.calls.push(['tab', 'list']);
    return structuredClone(this.tabs);
  }
  async createTab({ workspace, label }: { workspace: string; label: string }): Promise<NewTab> {
    this.calls.push(['tab', 'create', label]);
    if (this.failures.delete('create-refused')) {
      throw new HerdrError('refused', 'refused');
    }
    const id = this.next++;
    const tab = { tab_id: `tab${id}`, label, workspace_id: workspace };
    this.tabs.push(tab);
    this.panes.push({
      pane_id: `pane${id}`,
      terminal_id: `terminal${id}`,
      workspace_id: workspace,
      tab_id: tab.tab_id,
      agent: null,
      agent_status: 'idle',
    });
    if (this.failures.delete('create-lost')) {
      throw new HerdrError('timeout', 'timeout');
    }
    return { tab: tab.tab_id, pane: `pane${id}` };
  }
  async renameTab(tab: string, label: string): Promise<void> {
    this.calls.push(['tab', 'rename', tab, label]);
    this.found(this.tabs.find((t) => t.tab_id === tab)).label = label;
  }
  async movePane(
    pane: string,
    { tab, target, direction }: { tab: string; target: string; direction: 'right' | 'down' },
  ): Promise<void> {
    this.calls.push([
      'pane',
      'move',
      pane,
      '--tab',
      tab,
      '--target-pane',
      target,
      '--split',
      direction,
    ]);
    this.found(this.panes.find((p) => p.pane_id === pane)).tab_id = tab;
  }
  async closePane(pane: string): Promise<void> {
    this.calls.push(['pane', 'close', pane]);
    this.panes = this.panes.filter((p) => p.pane_id !== pane);
  }
  // Compose leaves starting agents and prompting them to hub.
  async startAgent(): Promise<Agent> {
    throw new Error('compose started an agent itself');
  }
  async prompt(): Promise<void> {
    throw new Error('compose prompted an agent itself');
  }

  // Hub

  check(): void {}
  refresh(): void {}
  members(): Membership[] {
    return structuredClone(this.memberships);
  }
  member(handle: string): Membership | null {
    return this.members().find((m) => m.handle === handle) ?? null;
  }
  memberByPane(pane: string): Membership | null {
    return (
      this.members().find((m) => m.pane_id === pane && ['pending', 'active'].includes(m.status)) ??
      null
    );
  }
  async start(
    agent: { definition: string; handle: string; prompt: string },
    paneId: string,
  ): Promise<void> {
    this.calls.push([
      'invite',
      agent.definition,
      '--handle',
      agent.handle,
      '--prompt',
      agent.prompt,
      '--pane',
      paneId,
    ]);
    this.starting++;
    this.maxStarting = Math.max(this.maxStarting, this.starting);
    try {
      if (this.startDelay) {
        await Bun.sleep(this.startDelay);
      }
      this.invite(agent, paneId);
    } finally {
      this.starting--;
    }
  }
  // Retires the members whose pane has closed, as a hub tick does.
  tick(): void {
    for (const m of this.memberships) {
      if (
        ['pending', 'active'].includes(m.status) &&
        !this.panes.some((p) => p.pane_id === m.pane_id)
      ) {
        m.status = 'gone';
      }
    }
  }
  // Another pane joins the room, as `herdr-hub join` there would.
  join(handle: string, paneId: string): void {
    const pane = this.found(this.panes.find((p) => p.pane_id === paneId));
    this.memberships.push(this.membership(handle, pane, pane.agent ?? null));
  }
  // Hub's state was removed: nobody is a member any more.
  forgetMembers(): void {
    this.memberships = [];
  }

  private invite(agent: { definition: string; handle: string }, paneId: string): void {
    const held = this.memberships.find((m) => m.handle === agent.handle);
    if (held && (['pending', 'active'].includes(held.status) || held.queuedFrom)) {
      throw new Error(`Handle @${agent.handle} is already in use.`);
    }
    const pane = this.found(this.panes.find((p) => p.pane_id === paneId));
    if (pane.agent) {
      throw new Error(`Pane ${paneId} already runs ${pane.agent}.`);
    }
    const kind = /^kind:\s*(\S+)/m.exec(fs.readFileSync(agent.definition, 'utf8'))?.[1] ?? 'codex';
    pane.agent = kind;
    pane.agent_session = { value: `session-${this.next++}` };
    this.memberships = this.memberships.filter((m) => m.handle !== agent.handle);
    this.memberships.push(this.membership(agent.handle, pane, kind));
    if (this.failures.delete('prompt')) {
      throw new Error(
        `Startup of @${agent.handle} in ${paneId} did not complete: timeout The agent or guide may already be present. Inspect the pane and room status before retrying; nothing was retried automatically.`,
      );
    }
  }
  private membership(handle: string, pane: SimPane, agent: string | null): Membership {
    return {
      handle,
      pane_id: pane.pane_id,
      joined_at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.next++)).toISOString(),
      status: 'active',
      terminal_id: pane.terminal_id,
      agent,
      queuedFrom: false,
    };
  }
  private found<T>(item: T | undefined): T {
    if (!item) {
      throw new HerdrError('not_found', 'not found');
    }
    return item;
  }
}

type Sim = {
  root: string;
  env: NodeJS.ProcessEnv;
  file: string;
  world: World;
  herdr: World;
  hub: World;
  write: (prompt?: string, layout?: string) => void;
  define: (name: string, text: string) => void;
};

// A team file and its definitions in a fresh folder, and a world with the lead's pane in it.
export function sim(): Sim {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-sim-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'lead',
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_TEAM_STATE_DIR: path.join(root, 'state'),
    HERDR_TEAM_DIR: path.join(root, 'team'),
  };
  const define = (name: string, text: string): void => {
    fs.mkdirSync(path.join(root, 'team', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'team', 'agents', `${name}.md`), text);
  };
  define('coordinator', '---\ndescription: coordinates the team\nkind: codex\n---\nCoordinate.\n');
  define(
    'reviewer',
    '---\ndescription: reviews the code\nkind: codex\nmodel: example-v1\n---\nReview when asked.\n',
  );
  const file = path.join(root, 'team.yaml');
  const write = (prompt = 'Review the code', layout = 'columns'): void =>
    fs.writeFileSync(
      file,
      `name: test
lead:
  use: coordinator
tabs:
  helpers:
    layout: ${layout}
agents:
  reviewer:
    use: reviewer
    tab: helpers
    prompt: ${prompt}
`,
    );
  write();
  const world = new World();
  return { root, env, file, world, herdr: world, hub: world, write, define };
}
