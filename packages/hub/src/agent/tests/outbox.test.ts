import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { join, leave, message } from '#agent';
import { tick } from '#rooms';
import { Store } from '#store';

async function outbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-outbox-'));
  const root = path.join(base, 'hub');
  onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = (pane: string) => ({
    HERDR_ENV: '1',
    HERDR_PANE_ID: pane,
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_TEAM_STATE_DIR: base,
  });
  await tick({
    root,
    herdr: {
      listPanes: async () => [],
      pane: async () => null,
      prompt: async () => {},
      startAgent: async () => {
        throw new Error('Unexpected agent startup.');
      },
    },
  });
  return { store: (room = 'w1') => new Store(root, room), env };
}

test('a post is queued right away for its addressees only, under the joined handle', async () => {
  const { store, env } = await outbox();
  join({ description: 'codex', env: env('p1') });
  join({ description: 'claude', env: env('p2') });
  join({ description: 'pi', env: env('p3') });
  const text = 'first line\n$(literal text) 🚀';
  message({ text: `@claude ${text}`, to: ['claude'], env: env('p1') });
  assert.deepEqual(
    store()
      .queued('claude')
      .map((q) => [q.from, q.kind, q.text]),
    [
      ['pi', 'joined', '@pi joined (pi).'],
      ['codex', 'message', `@claude ${text}`],
    ],
  );
  assert.deepEqual(store().queued('pi'), [], 'not mentioned: never gets it');
  assert.deepEqual(
    store()
      .queued('codex')
      .map((q) => q.kind),
    ['joined', 'joined'],
    'only the others joining; its own post is not for itself',
  );
  assert.deepEqual(store('w2').queued('claude'), [], 'other rooms are untouched');
  assert.throws(() => message({ text: 'forged', env: env('p9') }), /not joined/);
});

test('leave takes the member out at once and tells the others', async () => {
  const { store, env } = await outbox();
  join({ description: 'codex', env: env('p1') });
  join({ description: 'claude', env: env('p2') });
  message({ text: 'for codex', env: env('p2') });
  assert.match(leave({ env: env('p1') }), /You left the room/);
  assert.equal(store().member('codex')!.status, 'left');
  assert.deepEqual(store().queued('codex'), [], 'nothing more for it');
  const queued = store().queued('claude');
  assert.deepEqual(
    queued.map((q) => [q.from, q.kind]),
    [
      ['codex', 'undelivered'],
      ['codex', 'left'],
    ],
  );
  assert.match(queued[0]!.text, /was not delivered.*dropped/);
  assert.equal(queued[1]!.text, '@codex left the room.');
  assert.throws(() => message({ text: 'after leaving', env: env('p1') }), /not joined/);
});

test('invalid message text is never queued', async () => {
  const { store, env } = await outbox();
  join({ description: 'codex', env: env('p1') });
  join({ description: 'claude', env: env('p2') });
  assert.throws(() => message({ text: '  \n', env: env('p1') }), /empty/);
  assert.throws(() => message({ text: 'x'.repeat(16001), env: env('p1') }), /too long/);
  assert.throws(() => message({ text: 'a\0b', env: env('p1') }), /NUL/);
  assert.deepEqual(store().queued('claude'), []);
});
