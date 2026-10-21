// A persistent fake Herdr executable shared by compose and the real hub subprocesses.
import { onTestFinished } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliLayoutHerdr, type LayoutHerdr } from '@herdr/herdr';
import { fakeBin } from '../fake-bin.ts';

type State = {
  calls: string[][];
  // The most agent starts that were running at once.
  maxStarting?: number;
  panes: {
    pane_id: string;
    terminal_id: string;
    tab_id: string;
    workspace_id: string;
    agent: string | null;
    agent_status: string;
  }[];
};
type Fixture = {
  root: string;
  env: NodeJS.ProcessEnv;
  file: string;
  herdr: LayoutHerdr;
  tick: () => Promise<void>;
  write: (prompt?: string, layout?: string) => Promise<number>;
  define: (name: string, text: string) => Promise<number>;
  read: () => Promise<State>;
  change: (fields: Record<string, unknown>) => Promise<number>;
};
export async function fixture(): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-test-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, 'herdr.json');
  await Bun.write(
    state,
    JSON.stringify({
      next: 1,
      calls: [],
      tabs: [],
      panes: [
        {
          pane_id: 'lead',
          terminal_id: 'lead-terminal',
          workspace_id: 'w1',
          tab_id: 'user',
          agent: 'codex',
          agent_status: 'idle',
        },
      ],
    }),
  );
  const fake = fakeBin(
    'herdr',
    `#!${process.execPath}
import fs from 'node:fs';
const file = process.env.FAKE_STATE;
// up runs several of these at once: each holds the state file while it reads and writes it.
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const lock = () => { for (;;) { try { fs.mkdirSync(file + '.lock'); return; } catch { pause(2); } } };
const unlock = () => fs.rmSync(file + '.lock', { recursive: true, force: true });
const update = change => { lock(); const t = JSON.parse(fs.readFileSync(file, 'utf8')); change(t); fs.writeFileSync(file, JSON.stringify(t)); unlock(); };
const a = process.argv.slice(2);
// An agent takes startDelay ms to start; starts running at once are counted.
if (a[0] === 'agent' && a[1] === 'start') {
 let delay = 0;
 update(t => { t.starting = (t.starting ?? 0) + 1; t.maxStarting = Math.max(t.maxStarting ?? 0, t.starting); delay = t.startDelay ?? 0; });
 pause(delay);
 update(t => { t.starting--; });
}
lock();
process.on('exit', unlock);
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
s.calls.push(a);
const opt = key => a[a.indexOf(key) + 1];
const save = () => fs.writeFileSync(file, JSON.stringify(s));
const out = result => { save(); console.log(JSON.stringify({result})); };
const fail = code => {save(); console.error(JSON.stringify({error:{code,message:code}})); process.exit(1);};
if (a[0] === 'pane' && a[1] === 'list') out({panes:s.panes});
else if (a[0] === 'pane' && a[1] === 'get') {
 const pane = s.panes.find(p=>p.pane_id === a[2]);
 if (!pane) fail('pane_not_found');
 out({pane});
} else if (a[0] === 'tab' && a[1] === 'list') out({tabs:s.tabs});
else if (a[0] === 'tab' && a[1] === 'create') {
 if (s.rejectCreate) {s.rejectCreate=false;fail('refused');}
 const id = s.next++;
 const tab = {tab_id:'tab'+id,workspace_id:opt('--workspace'),label:opt('--label')};
 const pane = {pane_id:'pane'+id,terminal_id:'terminal'+id,workspace_id:tab.workspace_id,tab_id:tab.tab_id,agent:null,agent_status:'idle'};
 s.tabs.push(tab); s.panes.push(pane);
 if (s.failCreate) {s.failCreate=false;fail('timeout');}
 out({tab,root_pane:pane});
} else if (a[0] === 'tab' && a[1] === 'rename') {
 s.tabs.find(t=>t.tab_id===a[2]).label=a[3];out({});
} else if (a[0] === 'pane' && a[1] === 'move') {
 const p=s.panes.find(p=>p.pane_id===a[2]);
 p.tab_id=opt('--tab');out({});
} else if (a[0] === 'pane' && a[1] === 'close') {
 s.panes=s.panes.filter(p=>p.pane_id!==a[2]);out({});
} else if (a[0] === 'agent' && a[1] === 'start') {
 const p=s.panes.find(p=>p.pane_id===opt('--pane'));
 p.agent=opt('--kind');p.agent_session={value:'session-'+s.next++};out({agent:p});
} else if (a[0] === 'agent' && a[1] === 'prompt') {
 if (s.failPrompt) {s.failPrompt=false;fail('timeout');}
 out({});
} else fail('unsupported');
`,
  );
  const hub = process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-hub')]
    : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/hub/cli'))];
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'lead',
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_TEAM_STATE_DIR: path.join(root, 'state'),
    HERDR_BIN_PATH: fake,
    HERDR_TEAM_DIR: path.join(root, 'team'),
    FAKE_STATE: state,
    ...(process.env.HERDR_TEST_BIN_DIR ? { HERDR_TEAM_HUB_BIN: hub[0] } : {}),
  };
  async function tick(): Promise<void> {
    const proc = Bun.spawn([...hub, 'tick'], { env, stdout: 'pipe', stderr: 'pipe' });
    const error = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) {
      throw new Error(error);
    }
  }
  await tick();
  // Definitions in the fixture's herdr-team folder, which the manifest uses by name.
  const define = (name: string, text: string): Promise<number> =>
    Bun.write(path.join(root, 'team', 'agents', `${name}.md`), text);
  await define(
    'coordinator',
    '---\ndescription: coordinates the team\nkind: codex\n---\nCoordinate.\n',
  );
  await define(
    'reviewer',
    '---\ndescription: reviews the code\nkind: codex\nmodel: example-v1\n---\nReview when asked.\n',
  );
  const file = path.join(root, 'team.yaml');
  const write = (prompt = 'Review the code', layout = 'columns'): Promise<number> =>
    Bun.write(
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
  await write();
  const read = (): Promise<State> => Bun.file(state).json();
  const change = async (fields: Record<string, unknown>): Promise<number> =>
    Bun.write(state, JSON.stringify({ ...(await read()), ...fields }));
  return { root, env, file, herdr: cliLayoutHerdr(env), tick, write, define, read, change };
}
