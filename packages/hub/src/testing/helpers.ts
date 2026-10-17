// Shared by the tests: a fake Herdr, and a fresh state directory with helpers to drive a room.
import { onTestFinished } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Agent, type Herdr, HerdrError } from '@herdr/herdr';
import { join, message } from '#agent';
import { tick as runTick } from '#rooms';
import { type Entry, Store } from '#store';

// A room message as formatDelivery gets it.
export const entry = (id: string, from: string, text: string): Entry => ({
  id,
  from,
  kind: 'message',
  text,
  re: null,
});

// What waits for a member, by kind, oldest first.
export const kinds = (store: Store, handle: string): string[] =>
  store.queued(handle).map((q) => q.kind);

// Herdr as the router sees it, with agents the tests set up.
class FakeHerdr implements Herdr {
  agents: Agent[] = [];
  prompts: { pane: string; text: string }[] = [];
  failNext: Error | null = null;
  // While down, `herdr pane list` fails, as when Herdr is unreachable or restarting.
  down = false;

  async listPanes(): Promise<Agent[]> {
    if (this.down) {
      throw new HerdrError('timeout', 'herdr pane list timed out');
    }
    return structuredClone(this.agents);
  }

  async pane(pane: string): Promise<Agent | null> {
    if (this.down) {
      throw new HerdrError('timeout', 'herdr pane get timed out');
    }
    return structuredClone(this.agents.find((a) => a.pane_id === pane) ?? null);
  }

  // Like `herdr agent prompt --wait --until working`: returns once the agent started a turn.
  async prompt(pane: string, text: string): Promise<void> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.prompts.push({ pane, text });
    const agent = this.agents.find((a) => a.pane_id === pane);
    if (agent) {
      agent.agent_status = 'working';
    }
  }

  addAgent(pane: string, kind: string, terminal = `t-${pane}`): void {
    this.agents.push({
      pane_id: pane,
      terminal_id: terminal,
      agent: kind,
      agent_status: 'idle',
      interactive_ready: true,
    });
  }

  set(pane: string, fields: Partial<Agent>): void {
    const agent = this.agents.find((a) => a.pane_id === pane);
    if (!agent) {
      throw new Error(`no agent in pane ${pane}`);
    }
    Object.assign(agent, fields);
  }

  promptsTo(pane: string): { pane: string; text: string }[] {
    return this.prompts.filter((p) => p.pane === pane);
  }
}

export const fakeHerdr = () => new FakeHerdr();

export function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-agent-hub-test-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const herdr = fakeHerdr();
  const logs: string[] = [];
  const options = {
    root,
    herdr,
    log: (_room: string | null, text: string) => logs.push(text),
  };
  // What Herdr runs on every agent state change.
  const tick = (extra = {}) => runTick({ ...options, ...extra });
  const store = (workspace = 'w1') => new Store(root, workspace);
  const handles = (workspace = 'w1') =>
    store(workspace)
      .members('active')
      .map((m) => m.handle);
  const env = (pane: string, workspace = 'w1') => ({
    HERDR_ENV: '1',
    HERDR_PANE_ID: pane,
    HERDR_WORKSPACE_ID: workspace,
    HERDR_AGENT_HUB_DIR: root,
  });
  // The agent runs join during its turn; the tick when that turn ends admits it.
  async function joinAs(
    pane: string,
    description: string,
    kind = description.split(' ')[0] ?? description,
    workspace = 'w1',
  ) {
    if (!herdr.agents.some((a) => a.pane_id === pane)) {
      herdr.addAgent(pane, kind);
    }
    const out = join({ description, env: env(pane, workspace) });
    await tick();
    return out;
  }
  // An agent posts during its turn; the tick when that turn ends handles the post.
  const say = (pane: string, text: string, workspace = 'w1') => {
    message({ text, env: env(pane, workspace) });
    return tick();
  };
  // Agents settle back to idle after a turn.
  const settle = () =>
    herdr.agents.forEach((a) => {
      if (a.agent_status === 'working') {
        a.agent_status = 'idle';
      }
    });
  return { root, herdr, options, tick, say, store, handles, env, joinAs, settle, logs };
}

// setup() already ran no tick; the plugin's first event does that. Agent commands check it happened.
export async function installed() {
  const ctx = setup();
  await ctx.tick();
  return ctx;
}
