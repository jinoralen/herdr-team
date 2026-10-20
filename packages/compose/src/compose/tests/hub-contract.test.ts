// What compose relies on from hub's command line (ADR 0012), checked against the real hub:
// `status --json` and its version, and the two `invite` forms compose runs.
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
const NOT_UNDERSTOOD =
  /unknown option|unknown command|too many arguments|positional now|option now/;

test("compose reads the members from hub's versioned status --json", () => {
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
    /returned a status this compose doesn't read\. Rebuild both, or fix HERDR_TEAM_HUB_BIN\./,
  );
  fs.writeFileSync(other, `#!${process.execPath}\nconsole.log('usage: other-hub');\n`);
  assert.throws(
    () => new Hub({ ...env, HERDR_TEAM_HUB_BIN: other }).check(),
    /returned a status this compose doesn't read/,
  );
});

test('hub accepts the invite lines compose starts the lead and helpers with', async () => {
  const { hub, run } = setup();
  assert.equal(run(['tick']).code, 0);
  // The lead, in the caller's pane: refused only for want of a terminal here.
  const lead = run(hub.startArgs(AGENT));
  assert.equal(lead.code, 1);
  assert.match(lead.stderr, /interactive terminal/);
  assert.doesNotMatch(lead.stderr, NOT_UNDERSTOOD);
  // A helper, in its pane: refused only because this herdr has no such pane.
  await assert.rejects(hub.start(AGENT, 'w1:p9'), (error: Error) => {
    assert.match(error.message, /target pane does not exist/);
    assert.doesNotMatch(error.message, NOT_UNDERSTOOD);
    return true;
  });
});
