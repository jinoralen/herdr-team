// The fake Herdr as an executable, shared by compose and the real hub subprocesses it runs.
import { onTestFinished } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliLayoutHerdr, type LayoutHerdr } from '@herdr/herdr';
import {
  type HerdrState,
  herdrBin,
  herdrState,
  readHerdrState,
  writeHerdrState,
} from '../fake-herdr.ts';

type Fixture = {
  root: string;
  env: NodeJS.ProcessEnv;
  file: string;
  // The folder up runs in: the fixture's own, where its shared files go.
  cwd: string;
  herdr: LayoutHerdr;
  tick: () => Promise<void>;
  write: (prompt?: string, layout?: string) => Promise<number>;
  define: (name: string, text: string) => Promise<number>;
  read: () => HerdrState;
};
export async function fixture(): Promise<Fixture> {
  // Real path: a process started in it reports its cwd that way (macOS's /var is a link).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'compose-test-')));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, 'herdr.json');
  writeHerdrState(
    state,
    herdrState([
      {
        pane_id: 'lead',
        terminal_id: 'lead-terminal',
        workspace_id: 'w1',
        tab_id: 'user',
        agent: 'codex',
        agent_status: 'idle',
      },
    ]),
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
    HERDR_BIN_PATH: herdrBin(),
    HERDR_TEAM_DIR: path.join(root, 'team'),
    FAKE_HERDR_STATE: state,
    ...(process.env.HERDR_TEST_BIN_DIR ? { HERDR_TEAM_HUB_BIN: hub[0] } : {}),
  };
  async function tick(): Promise<void> {
    const proc = Bun.spawn([...hub, 'tick'], { env, stdout: 'pipe', stderr: 'pipe' });
    const error = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) {
      throw new Error(error);
    }
    // Notices reserve handles until a recipient next gets a message. A user-owned
    // agent models that conversation so lifecycle tests can retry after delivery.
    const snapshot = Bun.spawnSync([...hub, 'status', '--json'], { env });
    const members = JSON.parse(snapshot.stdout.toString()).members;
    if (members.some((m: { status: string }) => m.status === 'active')) {
      const joined = Bun.spawnSync(
        [...hub, 'join', '--handle', 'observer', '--description', 'test observer'],
        { env },
      );
      assert.equal(joined.exitCode, 0, joined.stderr.toString());
      const message = Bun.spawnSync([...hub, 'message', 'Continue.'], { env });
      assert.equal(message.exitCode, 0, message.stderr.toString());
      const delivery = Bun.spawnSync([...hub, 'tick'], { env });
      assert.equal(delivery.exitCode, 0, delivery.stderr.toString());
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
  const read = (): HerdrState => readHerdrState(state);
  return {
    root,
    env,
    file,
    cwd: root,
    herdr: cliLayoutHerdr(env),
    tick,
    write,
    define,
    read,
  };
}
