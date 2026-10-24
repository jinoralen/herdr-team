// Runs the real command parser in-process, with isolated IO and environment and the fake Herdr
// (../fake-herdr.ts) as its Exec. Process smoke tests opt in, and use the compiled executables
// when HERDR_TEST_BIN_DIR is set.

import { onTestFinished } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgram, type System } from '@herdr/hub/cli';
import {
  type Around,
  type FakePane,
  type HerdrState,
  herdrBin,
  herdrExec,
  herdrState,
  readHerdrState,
  writeHerdrState,
} from '../fake-herdr.ts';

const MAIN = fileURLToPath(import.meta.resolve('@herdr/hub/cli'));
const BIN_DIR: string | undefined = process.env.HERDR_TEST_BIN_DIR;
const COMMAND: string[] = BIN_DIR ? [path.resolve(BIN_DIR, 'herdr-hub')] : [process.execPath, MAIN];

// Unless a test gives its own: an idle codex in p1 and claude in p2.
const PANES: FakePane[] = [
  { pane_id: 'p1', terminal_id: 't1', agent: 'codex', agent_status: 'idle' },
  { pane_id: 'p2', terminal_id: 't2', agent: 'claude', agent_status: 'idle' },
];

type Result = { stdout: string; stderr: string; code: number };
type RunOptions = {
  stdin?: string;
  // As an agent in pane p1 (or paneId) of workspace w1.
  inPane?: boolean;
  paneId?: string;
  // More variables for this command only.
  env?: NodeJS.ProcessEnv;
  // In-process only: the parts of the system the command sees, e.g. a recorded execve.
  system?: Partial<System>;
};
type Cli = {
  root: string;
  // Herdr's state: in-process the live one a test may change, in process mode a copy.
  herdr: () => HerdrState;
  prompts: () => string;
  calls: () => string[][];
  env: NodeJS.ProcessEnv;
  // Runs `herdr-hub <args>`.
  run: (args: string[], options?: RunOptions) => Promise<Result>;
};

// env: more variables for every command, e.g. the HERDR_SOCKET_PATH Herdr gives a session.
// around: see Around; in-process only.
export function cli(
  env: Record<string, string> = {},
  options: { process?: boolean; panes?: FakePane[]; around?: Around } = {},
): Cli {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-cli-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const useProcess = options.process === true;
  const state = herdrState(structuredClone(options.panes ?? PANES));
  const stateFile = path.join(root, 'herdr.json');
  if (useProcess) {
    writeHerdrState(stateFile, state);
  }
  const base = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    HERDR_TEAM_STATE_DIR: path.join(root, 'state'),
    // Never the user's own definitions and teams: tests stay the same on any machine.
    HERDR_TEAM_DIR: path.join(root, 'team'),
    ...(useProcess && { HERDR_BIN_PATH: herdrBin(), FAKE_HERDR_STATE: stateFile }),
    ...env,
  };
  const pane = { HERDR_ENV: '1', HERDR_PANE_ID: 'p1', HERDR_WORKSPACE_ID: 'w1' };
  const exec = herdrExec(state, options.around);

  async function run(
    args: string[],
    { stdin, inPane = false, paneId = 'p1', env: extra = {}, system = {} }: RunOptions = {},
  ): Promise<Result> {
    const commandEnv = { ...base, ...(inPane && { ...pane, HERDR_PANE_ID: paneId }), ...extra };
    if (!useProcess) {
      let stdout = '';
      let stderr = '';
      const code = await createProgram({
        env: commandEnv,
        exec,
        stdout: (text: string) => {
          stdout += text;
        },
        stderr: (text: string) => {
          stderr += text;
        },
        stdin: async () => stdin ?? '',
        isTTY: { stdin: false, stdout: false },
        ...system,
      }).run(args);
      return { stdout, stderr, code };
    }
    const proc = Bun.spawn([...COMMAND, ...args], {
      env: commandEnv,
      stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  }

  const herdr = (): HerdrState => (useProcess ? readHerdrState(stateFile) : state);
  return {
    root,
    herdr,
    prompts: () => herdr().prompts.join(''),
    calls: () => herdr().calls,
    run,
    env: base,
  };
}
