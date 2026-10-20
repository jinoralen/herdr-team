import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guide, join, status } from '#agent';
import { dbPath, readLog, Store } from '#store';
import { installed } from '#testing';

function registration() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-registration-'));
  const root = path.join(base, 'hub');
  fs.mkdirSync(root);
  onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = (pane: string, workspace = 'w1') => ({
    HERDR_ENV: '1',
    HERDR_PANE_ID: pane,
    HERDR_WORKSPACE_ID: workspace,
    HERDR_TEAM_STATE_DIR: base,
  });
  return { root, env };
}

test('handles and membership remain isolated between workspaces', async () => {
  const { env, joinAs } = await installed();
  assert.match(await joinAs('p1', 'codex reviewer'), /as @codex\./);
  assert.match(await joinAs('p2', 'codex writer'), /as @codex-2\./);
  assert.match(await joinAs('p1', 'different role'), /You are @codex in chat room/);
  assert.match(await joinAs('p3', 'codex', 'codex', 'w2'), /as @codex\./);
  assert.match(guide({ env: env('p1') }), /@codex-2 — codex writer/);
  assert.doesNotMatch(guide({ env: env('p3', 'w2') }), /codex-2/);
});

test('status is scoped to its workspace and strips terminal control bytes', async () => {
  const { env, joinAs, say } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await say('p1', 'hello \x1b[31mRED\x1b[0m \x1b]0;PWNED\x07');
  const text = status({ env: env('p1') });
  assert.match(text, /@claude → @codex: hello .*RED/);
  assert.ok(!text.includes('\x1b') && !text.includes('\x07'), JSON.stringify(text));
  assert.match(status({ env: env('p2', 'w2') }), /^Room w2:\n\nMembers:\n {2}\(none\)/);
  assert.doesNotMatch(status({ env: env('p2', 'w2') }), /RED/, "another room's activity");
});

test('corrupt databases fail without replacing the original bytes', () => {
  const { root } = registration();
  const bytes = 'not a database'.repeat(100);
  fs.writeFileSync(dbPath(root), bytes);
  assert.throws(() => new Store(root, 'w1'), /not a database/);
  assert.equal(fs.readFileSync(dbPath(root), 'utf8'), bytes);
});

test('rolling back an outer transaction removes the join and its log together', async () => {
  const { env, store, root } = await installed();
  assert.throws(
    () =>
      store().transaction(() => {
        join({ description: 'codex', env: env('p1') });
        assert.ok(readLog(root, 'w1', 20).some((row) => row.text.includes('@codex joined')));
        throw new Error('invite prompt exceeds 100 KB');
      }),
    /exceeds 100 KB/,
  );
  assert.equal(store().member('codex'), null);
  assert.ok(readLog(root, 'w1', 20).every((row) => !row.text.includes('joined')));
});
