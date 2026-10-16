// Runs the real command line in a child process, the way Herdr and agents run it, against a fresh
// state directory and a fake `herdr` executable. The environment is built from scratch: the tests
// may themselves run inside a Herdr pane, whose HERDR_* variables must not leak in.

import { onTestFinished } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAIN = path.join(import.meta.dir, '..', 'main.ts');

// The fake herdr: agent list shows an idle codex and claude; prompts are appended to prompts.log.
const FAKE_HERDR = `#!/usr/bin/env bun
const [cmd, sub, pane, text] = process.argv.slice(2);
const out = (result) => console.log(JSON.stringify({ result }));
const agents = [
  { pane_id: 'p1', terminal_id: 't1', agent: 'codex', agent_status: 'idle' },
  { pane_id: 'p2', terminal_id: 't2', agent: 'claude', agent_status: 'idle' },
];
if (cmd === 'agent' && sub === 'list') {
  out({ agents });
} else if (cmd === 'agent' && sub === 'get') {
  out({ agent: agents.find((a) => a.pane_id === pane) });
} else if (cmd === 'agent' && sub === 'prompt') {
  require('node:fs').appendFileSync(process.env.PROMPTS, pane + ': ' + text + '\\n');
  out({ type: 'ok' });
}
`;

type Result = { stdout: string; stderr: string; code: number };
type Cli = {
  root: string;
  prompts: () => string;
  // Runs `herdr-agent-hub <args>`, as an agent in pane p1 when inPane is set.
  run: (
    args: string[],
    options?: { stdin?: string; inPane?: boolean; paneId?: string },
  ) => Promise<Result>;
};

export function cli(): Cli {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-agent-hub-cli-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const herdr = path.join(root, 'herdr');
  fs.writeFileSync(herdr, FAKE_HERDR, { mode: 0o755 });
  const promptsLog = path.join(root, 'prompts.log');
  const base = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    HERDR_AGENT_HUB_DIR: path.join(root, 'state'),
    HERDR_BIN_PATH: herdr,
    PROMPTS: promptsLog,
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
    const proc = Bun.spawn([process.execPath, MAIN, ...args], {
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
  return { root, prompts, run };
}
