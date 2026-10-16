// Runs the real CLI adapter against a fake `herdr` executable.

import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliHerdr } from '../client.ts';

function fakeBinary(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-herdr-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'herdr');
  fs.writeFileSync(bin, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o755 });
  return { bin, dir };
}

test('prompt text reaches herdr as one argv entry, untouched', async () => {
  const { bin, dir } = fakeBinary(
    `require('fs').writeFileSync(process.env.OUT, JSON.stringify(process.argv.slice(2))); console.log('{"result":{"type":"ok"}}');`,
  );
  const out = path.join(dir, 'argv.json');
  const text = 'line1\n$(touch /tmp/pwned) `id` ; \'q\' "dq" 🚀';
  await cliHerdr({ ...process.env, HERDR_BIN_PATH: bin, OUT: out }).prompt('w1:p1', text);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).slice(0, 4), [
    'agent',
    'prompt',
    'w1:p1',
    text,
  ]);
});

test('herdr JSON errors become coded errors', async () => {
  const { bin } = fakeBinary(
    `console.error('{"error":{"code":"agent_blocked","message":"blocked"}}'); process.exit(1);`,
  );
  await assert.rejects(cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).prompt('p', 'x'), {
    code: 'agent_blocked',
  });
});

test('missing binary is reported clearly', async () => {
  await assert.rejects(
    cliHerdr({ ...process.env, HERDR_BIN_PATH: '/nonexistent/herdr' }).listAgents(),
    { code: 'missing_binary' },
  );
});

test('listAgents parses the agent list', async () => {
  const { bin } = fakeBinary(
    `console.log(JSON.stringify({ id: 'x', result: { type: 'agent_list', agents: [{ pane_id: 'w1:p1', terminal_id: 't1', agent: 'claude', agent_status: 'idle' }] } }));`,
  );
  const agents = await cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).listAgents();
  assert.equal(agents[0]!.agent, 'claude');
});

test('malformed agent records are rejected before reaching the router', async () => {
  const { bin } = fakeBinary(
    `console.log(JSON.stringify({ result: { agents: [{ pane_id: 'p', terminal_id: 42, agent: 'codex', agent_status: 'idle' }] } }));`,
  );
  await assert.rejects(cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).listAgents(), {
    code: 'invalid_response',
  });
});
