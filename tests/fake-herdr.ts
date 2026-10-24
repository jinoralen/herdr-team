// The fake Herdr every test that crosses the herdr seam uses: one state of panes and tabs, and the
// output real herdr prints for the commands hub and compose run. In-process it is an Exec
// (herdrExec); tests that run real processes get an executable over a state file (herdrBin).
import fs from 'node:fs';
import type { Exec, Exited } from '@herdr/terminal';
import { fakeBin } from './fake-bin.ts';

export type FakePane = {
  pane_id: string;
  terminal_id: string;
  workspace_id?: string;
  tab_id?: string;
  agent: string | null;
  agent_status: string;
  agent_session?: { value: string };
};
export type HerdrState = {
  next: number;
  // Every command, in order, as its words after `herdr`.
  calls: string[][];
  panes: FakePane[];
  tabs: { tab_id: string; label: string; workspace_id: string }[];
  // What `agent prompt` delivered, as "pane: text" lines.
  prompts: string[];
  // Commands (`agent start`) that fail the next time they run, with this herdr error code.
  fail: Record<string, string>;
};

export function herdrState(panes: FakePane[]): HerdrState {
  return { next: 1, calls: [], panes, tabs: [], prompts: [], fail: {} };
}

const out = (result: unknown): Exited => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ result })}\n`,
  stderr: '',
  timedOut: false,
});
const fail = (code: string): Exited => ({
  exitCode: 1,
  stdout: '',
  stderr: `${JSON.stringify({ error: { code, message: code } })}\n`,
  timedOut: false,
});

const paneOf = (s: HerdrState, id: string | undefined): FakePane | undefined =>
  s.panes.find((p) => p.pane_id === id);

function createTab(s: HerdrState, workspace: string, label: string): Exited {
  const id = s.next++;
  const tab = { tab_id: `tab${id}`, workspace_id: workspace, label };
  const root = {
    pane_id: `pane${id}`,
    terminal_id: `terminal${id}`,
    workspace_id: workspace,
    tab_id: tab.tab_id,
    agent: null,
    agent_status: 'idle',
  };
  s.tabs.push(tab);
  s.panes.push(root);
  return out({ tab, root_pane: root });
}

// Changes the pane, or fails as herdr does for a pane that isn't there.
function withPane(
  s: HerdrState,
  id: string | undefined,
  change: (pane: FakePane) => unknown,
): Exited {
  const pane = paneOf(s, id);
  return pane ? out(change(pane)) : fail('pane_not_found');
}

// One herdr command against the state, as herdr would answer it.
function answer(s: HerdrState, args: string[]): Exited {
  s.calls.push(args);
  const command = `${args[0]} ${args[1]}`;
  const opt = (key: string): string => args[args.indexOf(key) + 1] ?? '';
  const failure = s.fail[command];
  if (failure) {
    delete s.fail[command];
    return fail(failure);
  }
  switch (command) {
    case 'pane list':
      return out({ panes: s.panes });
    case 'pane get':
      return withPane(s, args[2], (pane) => ({ pane }));
    case 'pane move':
      return withPane(s, args[2], (pane) => {
        pane.tab_id = opt('--tab');
        return {};
      });
    case 'pane close':
      s.panes = s.panes.filter((p) => p.pane_id !== args[2]);
      return out({});
    case 'tab list':
      return out({ tabs: s.tabs });
    case 'tab create':
      return createTab(s, opt('--workspace'), opt('--label'));
    case 'tab rename':
      for (const tab of s.tabs.filter((t) => t.tab_id === args[2])) {
        tab.label = args[3] ?? '';
      }
      return out({});
    case 'agent start':
      return withPane(s, opt('--pane'), (pane) => {
        pane.agent = opt('--kind');
        pane.agent_session = { value: `session-${s.next++}` };
        return { agent: pane };
      });
    case 'agent prompt':
      s.prompts.push(`${args[2]}: ${args[3]}\n`);
      return out({ type: 'ok' });
    default:
      return fail('unsupported');
  }
}

// around: runs before and after a command (next answers it), for a test that changes the world
// at that moment, e.g. a tick that runs while an agent starts.
export type Around = (args: string[], next: () => Exited) => Promise<Exited>;

export function herdrExec(state: HerdrState, around?: Around): Exec {
  return async ([, ...args]: string[]): Promise<Exited> =>
    around ? around(args, () => answer(state, args)) : answer(state, args);
}

// The herdr executable for real processes, over the state in FAKE_HERDR_STATE.
export function herdrBin(): string {
  return fakeBin(
    'herdr',
    `#!${process.execPath}\nimport { serve } from ${JSON.stringify(import.meta.path)};\nserve();\n`,
  );
}

export const writeHerdrState = (file: string, state: HerdrState): void =>
  fs.writeFileSync(file, JSON.stringify(state));
export const readHerdrState = (file: string): HerdrState =>
  JSON.parse(fs.readFileSync(file, 'utf8'));

// What herdrBin runs. compose runs several at once: each holds the state file while it reads and
// writes it.
/** @public imported by the script herdrBin writes, which Knip doesn't see */
export function serve(): void {
  const file = process.env.FAKE_HERDR_STATE ?? '';
  const lock = `${file}.lock`;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
  }
  try {
    const state = readHerdrState(file);
    const exited = answer(state, process.argv.slice(2));
    writeHerdrState(file, state);
    process.stdout.write(exited.stdout);
    process.stderr.write(exited.stderr);
    process.exitCode = exited.exitCode;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
