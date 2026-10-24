// What compose relies on from hub's command line (ADR 0012), checked against the real hub:
// `status --json` and its version, and the pane-targeted `invite` compose runs.
import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../hub.ts';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-contract-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  // A herdr that knows no panes: startup fails at its first Herdr call, after hub parsed the line.
  const herdr = path.join(root, 'herdr');
  fs.writeFileSync(
    herdr,
    `#!${process.execPath}
const [noun, verb] = process.argv.slice(2);
if (noun === 'pane' && verb === 'get') {
  console.error(JSON.stringify({ error: { code: 'pane_not_found', message: 'pane_not_found' } }));
  process.exit(1);
}
console.log(JSON.stringify({ result: { panes: [] } }));
`,
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(root, 'team', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'team', 'agents', 'reviewer.md'),
    '---\ndescription: reviews the code\nkind: codex\n---\nReview when asked.\n',
  );
  const env = {
    PATH: process.env.PATH ?? '',
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'p1',
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_TEAM_STATE_DIR: path.join(root, 'state'),
    HERDR_TEAM_DIR: path.join(root, 'team'),
    HERDR_BIN_PATH: herdr,
    // Against the built hub when the tests run on dist/, as Herdr and agents run it.
    ...(process.env.HERDR_TEST_BIN_DIR && {
      HERDR_TEAM_HUB_BIN: path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-hub'),
    }),
  };
  const hub = new Hub(env);
  const run = (args: string[]) => {
    const result = Bun.spawnSync([...hub.words, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    return { code: result.exitCode, stderr: result.stderr.toString() };
  };
  return { root, env, hub, run };
}

const AGENT = { definition: 'reviewer', handle: 'reviewer', prompt: 'Review the cache.' };
// What hub prints when it doesn't understand the line it was given.
const NOT_UNDERSTOOD = /unknown option|unknown command|too many arguments/;

test("compose reads the members from hub's status --json", async () => {
  const { hub, run } = setup();
  assert.equal(run(['tick']).code, 0);
  assert.equal(run(['join', '--handle', 'reviewer', '--description', 'reviews']).code, 0);
  assert.deepEqual(
    { ...(await hub.member('reviewer')), joined_at: 'time' },
    {
      handle: 'reviewer',
      pane_id: 'p1',
      joined_at: 'time',
      status: 'pending',
      terminal_id: null,
      agent: null,
      queuedFrom: false,
    },
  );
});

test('compose refuses a hub whose status --json it does not read, or that prints no JSON', async () => {
  const { env } = setup();
  let stdout = JSON.stringify({ room: 'w1', members: [{ handle: 'x' }] });
  const hub = new Hub(env, async () => ({ exitCode: 0, stdout, stderr: '', timedOut: false }));
  await assert.rejects(
    hub.check(),
    /returned a status this compose doesn't read \(at members\.0\.pane_id\)\. Rebuild both, or fix HERDR_TEAM_HUB_BIN\./,
  );
  stdout = 'usage: other-hub';
  await assert.rejects(hub.check(), /printed no JSON for status --json\. Rebuild both/);
});

test('lookups share one status --json until refresh, and a failed one is read again', async () => {
  const { env } = setup();
  const calls: string[][] = [];
  let exitCode = 0;
  const hub = new Hub(env, async (args, options) => {
    calls.push(args);
    assert.equal(options.env, env);
    const stdout = JSON.stringify({ room: 'w1', members: [] });
    return { exitCode, stdout, stderr: 'locked', timedOut: false };
  });
  await Promise.all([hub.member('a'), hub.memberByPane('w1:p1')]);
  await hub.members();
  assert.deepEqual(calls, [[...hub.words, 'status', '--json']]);
  hub.refresh();
  exitCode = 1;
  await assert.rejects(hub.member('a'), /locked/);
  exitCode = 0;
  await hub.member('a');
  assert.equal(calls.length, 3);
});

test('hub accepts the invite lines compose starts the lead and helpers with', async () => {
  const { hub, run } = setup();
  assert.equal(run(['tick']).code, 0);
  // Lead and helpers use the same pane-targeted invitation.
  await assert.rejects(hub.start(AGENT, 'w1:p9'), (error: Error) => {
    assert.match(error.message, /target pane does not exist/);
    assert.doesNotMatch(error.message, NOT_UNDERSTOOD);
    return true;
  });
});
