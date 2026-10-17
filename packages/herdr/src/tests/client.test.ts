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
    cliHerdr({ ...process.env, HERDR_BIN_PATH: '/nonexistent/herdr' }).listPanes(),
    { code: 'missing_binary' },
  );
});

test('listPanes parses the pane list, panes without an agent included', async () => {
  const { bin } = fakeBinary(
    `console.log(JSON.stringify({ id: 'x', result: { type: 'pane_list', panes: [{ pane_id: 'w1:p1', terminal_id: 't1', agent: 'claude', agent_status: 'idle' }, { pane_id: 'w1:p2', terminal_id: 't2', agent_status: 'unknown' }] } }));`,
  );
  const panes = await cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).listPanes();
  assert.deepEqual(
    panes.map((p) => p.agent),
    ['claude', undefined],
  );
});

test('a closed pane is null', async () => {
  const { bin } = fakeBinary(
    `console.error('{"error":{"code":"pane_not_found","message":"pane w1:p9 not found"}}'); process.exit(1);`,
  );
  assert.equal(await cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).pane('w1:p9'), null);
});

test('malformed agent records are rejected before reaching the router', async () => {
  const { bin } = fakeBinary(
    `console.log(JSON.stringify({ result: { panes: [{ pane_id: 'p', terminal_id: 42, agent: 'codex', agent_status: 'idle' }] } }));`,
  );
  await assert.rejects(cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).listPanes(), {
    code: 'invalid_response',
  });
});

test('agent startup passes the target pane and validates the returned agent', async () => {
  const { bin, dir } = fakeBinary(`
require('node:fs').writeFileSync(process.env.OUT, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ result: { agent: {
  pane_id: 'w2:p3', workspace_id: 'w2', terminal_id: 't3', agent: 'codex', agent_status: 'idle'
} } }));`);
  const out = path.join(dir, 'args.json');
  const agent = await cliHerdr({ ...process.env, HERDR_BIN_PATH: bin, OUT: out }).startAgent({
    kind: 'codex',
    paneId: 'w2:p3',
  });
  assert.equal(agent.workspace_id, 'w2');
  assert.equal(agent.terminal_id, 't3');
  const args = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(args.slice(0, 2), ['agent', 'start']);
  assert.match(args[2], /^hub-/);
  assert.deepEqual(args.slice(3), ['--kind', 'codex', '--pane', 'w2:p3', '--timeout', '120000']);
});

test('agent startup rejects malformed success responses', async () => {
  const { bin } = fakeBinary(
    `console.log(JSON.stringify({ result: { agent: { pane_id: 'p' } } }));`,
  );
  await assert.rejects(
    cliHerdr({ ...process.env, HERDR_BIN_PATH: bin }).startAgent({ kind: 'codex', paneId: 'p' }),
    { code: 'invalid_response' },
  );
});
