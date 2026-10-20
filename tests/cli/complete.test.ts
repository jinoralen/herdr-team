import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli } from './run-cli.ts';

test('__complete lists the definitions that load, with their descriptions', async () => {
  const { run, root } = cli();
  const agents = path.join(root, 'team', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(
    path.join(agents, 'reviewer.md'),
    '---\ndescription: reviews\tarchitecture\n---\n',
  );
  fs.writeFileSync(path.join(agents, 'broken.md'), 'no frontmatter\n');
  const { stdout, code } = await run(['__complete', 'definitions']);
  assert.equal(code, 0);
  assert.equal(stdout, 'reviewer\treviews architecture\n');
});

test("__complete lists the other active members of the pane's room, and nothing outside it", async () => {
  const { run } = cli();
  await run(['tick']);
  await run(['join', '--description', 'codex'], { inPane: true });
  await run(['join', '--description', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  assert.equal((await run(['__complete', 'handles'], { inPane: true })).stdout, 'claude\tclaude\n');
  assert.equal((await run(['__complete', 'handles'])).stdout, '');
});

test('__complete leaves a database from another build as it is, and offers no handles', async () => {
  const { run, root } = cli();
  const dir = path.join(root, 'state', 'hub');
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'chat.db'));
  db.exec('CREATE TABLE members (handle TEXT); PRAGMA user_version = 99;');
  db.close();
  const before = fs.readFileSync(path.join(dir, 'chat.db'));
  const { stdout, code } = await run(['__complete', 'handles'], { inPane: true });
  assert.deepEqual([code, stdout], [0, '']);
  assert.deepEqual(fs.readdirSync(dir), ['chat.db']);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'chat.db')), before);
});

test('__complete creates no database where there is none', async () => {
  const { run, root } = cli();
  assert.equal((await run(['__complete', 'handles'], { inPane: true })).stdout, '');
  assert.equal(fs.existsSync(path.join(root, 'state', 'hub', 'chat.db')), false);
});

test('__complete prints nothing for what it does not know, and stays out of help', async () => {
  const { run } = cli();
  const unknown = await run(['__complete', 'nonsense']);
  assert.deepEqual([unknown.code, unknown.stdout, unknown.stderr], [0, '', '']);
  assert.ok(!(await run(['--help'])).stdout.includes('__complete'));
});
