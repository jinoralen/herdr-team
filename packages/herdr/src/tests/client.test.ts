// The herdr adapter against a recorded Exec that answers with what herdr prints. The process itself
// is @herdr/terminal's spawnExec, tested there.

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Exited } from '@herdr/terminal';
import { cliHerdr } from '../client.ts';

const ok = (result: unknown): Exited => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ result })}\n`,
  stderr: '',
  timedOut: false,
});
const failed = (stderr: string, more: Partial<Exited> = {}): Exited => ({
  exitCode: 1,
  stdout: '',
  stderr,
  timedOut: false,
  ...more,
});

// exited: what herdr prints, or the spawn error a missing herdr rejects with.
function recorded(exited: Exited | Error) {
  const calls: string[][] = [];
  const herdr = cliHerdr({ HERDR_BIN_PATH: '/bin/herdr' }, async ([bin, ...args]) => {
    assert.equal(bin, '/bin/herdr');
    calls.push(args);
    if (exited instanceof Error) {
      throw exited;
    }
    return exited;
  });
  return { herdr, calls };
}

test('prompt text reaches herdr as one argv entry, untouched', async () => {
  const { herdr, calls } = recorded(ok({ type: 'ok' }));
  const text = 'line1\n$(touch /tmp/pwned) `id` ; \'q\' "dq" 🚀';
  await herdr.prompt('w1:p1', text);
  assert.deepEqual(calls[0]!.slice(0, 4), ['agent', 'prompt', 'w1:p1', text]);
});

test('herdr JSON errors become coded errors', async () => {
  const { herdr } = recorded(failed('{"error":{"code":"agent_blocked","message":"blocked"}}\n'));
  await assert.rejects(herdr.prompt('p', 'x'), { code: 'agent_blocked', message: 'blocked' });
});

test('a failure without herdr JSON is a process exit, not a timeout', async () => {
  const { herdr } = recorded(failed('panic: socket closed\n', { exitCode: 2 }));
  await assert.rejects(herdr.listPanes(), {
    code: 'process_exit',
    message: 'panic: socket closed',
  });
});

test('a herdr that outlives its timeout is reported as one', async () => {
  const { herdr } = recorded(failed('', { exitCode: 137, timedOut: true }));
  await assert.rejects(herdr.listPanes(), { code: 'timeout' });
});

test('non-JSON success output is an invalid response', async () => {
  const { herdr } = recorded({ ...ok(null), stdout: 'usage: herdr' });
  await assert.rejects(herdr.listPanes(), { code: 'invalid_response' });
});

test('missing binary is reported clearly', async () => {
  const { herdr } = recorded(Object.assign(new Error('spawn'), { code: 'ENOENT' }));
  await assert.rejects(herdr.listPanes(), { code: 'missing_binary' });
});

test('listPanes parses the pane list, panes without an agent included', async () => {
  const { herdr, calls } = recorded(
    ok({
      panes: [
        { pane_id: 'w1:p1', terminal_id: 't1', agent: 'claude', agent_status: 'idle' },
        { pane_id: 'w1:p2', terminal_id: 't2', agent_status: 'unknown' },
      ],
    }),
  );
  assert.deepEqual(
    (await herdr.listPanes()).map((p) => p.agent),
    ['claude', undefined],
  );
  assert.deepEqual(calls, [['pane', 'list']]);
});

test('a closed pane is null', async () => {
  const { herdr, calls } = recorded(failed('{"error":{"code":"pane_not_found"}}'));
  assert.equal(await herdr.pane('w1:p9'), null);
  assert.deepEqual(calls, [['pane', 'get', 'w1:p9']]);
});

test('malformed agent records are rejected before reaching the router', async () => {
  const { herdr } = recorded(
    ok({ panes: [{ pane_id: 'p', terminal_id: 42, agent: 'codex', agent_status: 'idle' }] }),
  );
  await assert.rejects(herdr.listPanes(), { code: 'invalid_response' });
});

const AGENT = {
  pane_id: 'w2:p3',
  workspace_id: 'w2',
  terminal_id: 't3',
  agent: 'codex',
  agent_status: 'idle',
};

test('agent startup passes the target pane and validates the returned agent', async () => {
  const { herdr, calls } = recorded(ok({ agent: AGENT }));
  const agent = await herdr.startAgent({ label: 'reviewer', kind: 'codex', paneId: 'w2:p3' });
  assert.equal(agent.workspace_id, 'w2');
  assert.equal(agent.terminal_id, 't3');
  assert.deepEqual(calls, [
    [
      'agent',
      'start',
      'reviewer-w2-p3',
      '--kind',
      'codex',
      '--pane',
      'w2:p3',
      '--timeout',
      '120000',
    ],
  ]);
});

test('agent names keep mixed-case pane IDs distinct and fit Herdr rules', async () => {
  const { herdr, calls } = recorded(ok({ agent: AGENT }));
  for (const [label, paneId] of [
    ['reviewer', 'w2N:p3'],
    ['reviewer', 'w2n:p3'],
    ['2nd', 'w1:p1'],
    ['a-very-long-handle-x', 'w2NVX:p1234'],
  ] as const) {
    await herdr.startAgent({ label, kind: 'codex', paneId });
  }
  assert.deepEqual(
    calls.map((args) => args[2]),
    ['reviewer-w2_n-p3', 'reviewer-w2n-p3', 'agent-2nd-w1-p1', 'a-very-long-handl-w2_n_v_x-p1234'],
  );
});

test('agent startup rejects malformed success responses', async () => {
  const { herdr } = recorded(ok({ agent: { pane_id: 'p' } }));
  await assert.rejects(herdr.startAgent({ label: 'codex', kind: 'codex', paneId: 'p' }), {
    code: 'invalid_response',
  });
});
