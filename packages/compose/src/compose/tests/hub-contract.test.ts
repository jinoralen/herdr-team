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

test("compose reads the members from hub's status --json", () => {
  const { hub, run } = setup();
  assert.equal(run(['tick']).code, 0);
  assert.equal(run(['join', '--handle', 'reviewer', '--description', 'reviews']).code, 0);
  assert.deepEqual(
    { ...hub.member('reviewer'), joined_at: 'time' },
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

test('compose refuses a hub whose status --json it does not read, or that prints no JSON', () => {
  const { root, env } = setup();
  const other = path.join(root, 'other-hub');
  fs.writeFileSync(
    other,
    `#!${process.execPath}\nconsole.log(JSON.stringify({ room: 'w1', members: [{ handle: 'x' }] }));\n`,
    { mode: 0o755 },
  );
  assert.throws(
    () => new Hub({ ...env, HERDR_TEAM_HUB_BIN: other }).check(),
    /returned a status this compose doesn't read \(at members\.0\.pane_id\)\. Rebuild both, or fix HERDR_TEAM_HUB_BIN\./,
  );
  fs.writeFileSync(other, `#!${process.execPath}\nconsole.log('usage: other-hub');\n`);
  assert.throws(
    () => new Hub({ ...env, HERDR_TEAM_HUB_BIN: other }).check(),
    /printed no JSON for status --json\. Rebuild both/,
  );
});

test('lookups share one status --json until refresh', () => {
  const { root, env } = setup();
  const counted = path.join(root, 'counted-hub');
  const calls = path.join(root, 'calls');
  fs.writeFileSync(
    counted,
    `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'x');\nconsole.log(JSON.stringify({ room: 'w1', members: [] }));\n`,
    { mode: 0o755 },
  );
  const hub = new Hub({ ...env, HERDR_TEAM_HUB_BIN: counted });
  const runs = (): number => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').length : 0);
  hub.member('a');
  hub.memberByPane('w1:p1');
  hub.members();
  assert.equal(runs(), 1);
  hub.refresh();
  hub.member('a');
  assert.equal(runs(), 2);
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
