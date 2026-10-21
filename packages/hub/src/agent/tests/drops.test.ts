import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { join, leave, message } from '#agent';
import { filesDir, Store } from '#store';
import { installed } from '#testing';

test('leaving before admission withdraws the pending sender posts and join notice', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  join({ description: 'ghost', env: env('p9') });
  message({ text: 'unapproved', env: env('p9') });
  leave({ env: env('p9') });
  assert.deepEqual(
    store()
      .queued('claude')
      .map((q) => q.kind),
    ['left'],
  );
});

for (const action of ['remove', 'reject'] as const) {
  test(`${action} replaces outstanding delivery warnings with final drop warnings`, async () => {
    const { env, joinAs, store } = await installed();
    await joinAs('p1', 'claude');
    join({ description: 'ghost', env: env('p9') });
    const s = store();
    const id = s.enqueue('claude', 'question', ['ghost']);
    s.setUnsure('ghost', [id], true);
    s.enqueue('ghost', 'It is repeated later', ['claude'], { kind: 'undelivered', re: id });
    const member = s.member('ghost')!;
    if (action === 'remove') {
      s.remove(member, 'left', 'left');
    } else {
      s.reject(member, 'no agent');
    }
    const warnings = s.queued('claude').filter((q) => q.kind === 'undelivered');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.re, id);
    assert.match(warnings[0]!.text, /may not have arrived, and will not be repeated.*dropped/);
    assert.deepEqual(s.queued('ghost'), []);
    s.dequeue(
      'claude',
      s
        .queued('claude')
        .filter((q) => q.kind !== 'undelivered')
        .map((q) => q.id),
    );
    assert.equal(s.hasQueuedFrom('ghost'), false, 'warnings do not reserve a departed handle');
  });
}

test('a recipient leaving after address selection cannot leave an orphan post', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const original = Store.prototype.handles;
  let removed = false;
  Store.prototype.handles = function () {
    const handles = original.call(this);
    if (!removed) {
      removed = true;
      const s = store();
      s.remove(s.member('codex')!, 'left', 'left');
    }
    return handles;
  };
  try {
    assert.throws(
      () => message({ text: 'orphan', to: ['codex'], env: env('p1') }),
      /[Nn]o.*recipient|[Nn]ot.*room/,
    );
  } finally {
    Store.prototype.handles = original;
  }
  assert.deepEqual(store().queued('codex'), []);
});

test('delivery warnings alone do not reserve their subject handle', async () => {
  const { store } = await installed();
  store().enqueue('gone', 'warning', ['author'], { kind: 'undelivered' });
  assert.equal(store().hasQueuedFrom('gone'), false);
});

// Notices wake nobody, so an idle recipient may hold them indefinitely.
test('join and leave notices alone do not reserve a departed handle', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'pi');
  store().remove(store().member('pi')!, 'gone', 'left: pane closed');
  assert.equal(store().hasQueuedFrom('pi'), false);
  join({ description: 'pi again', handle: 'pi', env: env('p3') });
  assert.deepEqual(
    store()
      .queued('claude')
      .map((q) => [q.from, q.kind]),
    [
      ['pi', 'joined'],
      ['pi', 'left'],
      ['pi', 'joined'],
    ],
  );
});

test('refusing a join keeps the left notice of the handle previous member', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'pi');
  store().remove(store().member('pi')!, 'gone', 'left: pane closed');
  join({ description: 'pi again', handle: 'pi', env: env('p3') });
  store().reject(store().member('pi')!, 'no agent');
  assert.deepEqual(
    store()
      .queued('claude')
      .map((q) => q.text),
    ['@pi left: pane closed.'],
  );
});

test('a post reports recipients that left while retaining the remaining recipients', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  const original = Store.prototype.handles;
  let removed = false;
  Store.prototype.handles = function () {
    const handles = original.call(this);
    if (!removed) {
      removed = true;
      const s = store();
      s.remove(s.member('codex')!, 'left', 'left');
    }
    return handles;
  };
  try {
    const output = message({ text: 'remaining', to: ['codex', 'pi'], env: env('p1') });
    assert.match(output, /Not queued for @codex/);
  } finally {
    Store.prototype.handles = original;
  }
  assert.deepEqual(store().queued('codex'), []);
  assert.ok(
    store()
      .queued('pi')
      .some((q) => q.text === 'remaining'),
  );
});

test('removing a pending member keeps the warnings about it that other authors wait for', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  join({ description: 'ghost', env: env('p9') });
  const s = store();
  const id = s.enqueue('claude', 'question', ['ghost']);
  s.dequeue('ghost', [id]);
  s.enqueue('ghost', 'Your message was dropped', ['claude'], { kind: 'undelivered', re: id });
  s.remove(s.member('ghost')!, 'gone', 'is gone');
  assert.ok(
    s.queued('claude').some((q) => q.kind === 'undelivered' && q.re === id),
    'the warning survives its subject leaving',
  );
});

test('a refused post takes back the attachments it copied', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const source = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-attach-')), 'note.txt');
  fs.writeFileSync(source, 'note');
  const original = Store.prototype.handles;
  let removed = false;
  Store.prototype.handles = function () {
    const handles = original.call(this);
    if (!removed) {
      removed = true;
      const s = store();
      s.remove(s.member('codex')!, 'left', 'left');
    }
    return handles;
  };
  try {
    assert.throws(
      () => message({ text: 'see file', to: ['codex'], attach: [source], env: env('p1') }),
      /No recipients remain/,
    );
  } finally {
    Store.prototype.handles = original;
  }
  assert.deepEqual(fs.readdirSync(filesDir(store().root)), []);
});
