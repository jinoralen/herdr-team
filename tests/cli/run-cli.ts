// Runs the real command line in a child process, the way Herdr and agents run it, against a fresh
// state directory and a fake `herdr` executable. The environment is built from scratch: the tests
// may themselves run inside a Herdr pane, whose HERDR_* variables must not leak in.

import { onTestFinished } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBin } from '../fake-bin.ts';

const MAIN = fileURLToPath(import.meta.resolve('@herdr/hub/cli'));
const BIN_DIR: string | undefined = process.env.HERDR_TEST_BIN_DIR;
const COMMAND: string[] = BIN_DIR ? [path.resolve(BIN_DIR, 'herdr-hub')] : [process.execPath, MAIN];

// The fake herdr: pane list shows an idle codex and claude; prompts are appended to prompts.log.
const FAKE_HERDR = `#!/usr/bin/env bun
const [cmd, sub, pane, text] = process.argv.slice(2);
require('node:fs').appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
const out = (result) => console.log(JSON.stringify({ result }));
const agents = [
  { pane_id: 'p1', terminal_id: 't1', agent: 'codex', agent_status: 'idle' },
  { pane_id: 'p2', terminal_id: 't2', agent: 'claude', agent_status: 'idle' },
];
if (cmd === 'pane' && sub === 'list') {
  out({ panes: agents });
} else if (cmd === 'pane' && sub === 'get') {
  out({ pane: agents.find((a) => a.pane_id === pane) });
} else if (cmd === 'agent' && sub === 'prompt') {
  require('node:fs').appendFileSync(process.env.PROMPTS, pane + ': ' + text + '\\n');
  out({ type: 'ok' });
}
`;

type Result = { stdout: string; stderr: string; code: number };
type Cli = {
  root: string;
  prompts: () => string;
  calls: () => string[][];
  // Runs `herdr-hub <args>`, as an agent in pane p1 when inPane is set.
  run: (
    args: string[],
    options?: { stdin?: string; inPane?: boolean; paneId?: string },
  ) => Promise<Result>;
};

// env: more variables for every command, e.g. the HERDR_SOCKET_PATH Herdr gives a session.
export function cli(env: Record<string, string> = {}): Cli {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-cli-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const herdr = fakeBin('herdr', FAKE_HERDR);
  const promptsLog = path.join(root, 'prompts.log');
  const base = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    HERDR_TEAM_STATE_DIR: path.join(root, 'state'),
    // Never the user's own definitions and teams: tests stay the same on any machine.
    HERDR_TEAM_DIR: path.join(root, 'team'),
    HERDR_BIN_PATH: herdr,
    PROMPTS: promptsLog,
    CALLS: path.join(root, 'calls.log'),
    ...env,
  };
  const pane = { HERDR_ENV: '1', HERDR_PANE_ID: 'p1', HERDR_WORKSPACE_ID: 'w1' };

  async function run(
    args: string[],
    {
      stdin,
      inPane = false,
      paneId = 'p1',
    }: { stdin?: string; inPane?: boolean; paneId?: string } = {},
  ): Promise<Result> {
    const proc = Bun.spawn([...COMMAND, ...args], {
      env: inPane ? { ...base, ...pane, HERDR_PANE_ID: paneId } : base,
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

  const prompts = (): string =>
    fs.existsSync(promptsLog) ? fs.readFileSync(promptsLog, 'utf8') : '';
  const calls = (): string[][] => {
    const file = path.join(root, 'calls.log');
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  };
  return { root, prompts, calls, run };
}
