import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { status } from '#agent';
import { dbPath } from '#store';
import { installed, setup } from '#testing';

test('JSON status reads a snapshot while another connection holds the write lock', async () => {
  const { root, env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  const writer = new Database(dbPath(root));
  writer.exec('BEGIN IMMEDIATE');
  try {
    writer.exec("UPDATE members SET description = 'uncommitted' WHERE room = 'w1'");
    const snapshot = JSON.parse(status({ env: env('p1'), json: true }));
    assert.equal(snapshot.members[0].description, 'claude');
    assert.equal(store().member('claude')!.description, 'claude');
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }
});

test('JSON status before the first tick returns an empty room without creating a database', () => {
  const { root, env } = setup();
  assert.deepEqual(JSON.parse(status({ env: env('p1'), json: true })), {
    room: 'w1',
    members: [],
  });
  assert.equal(fs.existsSync(dbPath(root)), false);
});

test('JSON status reads a database still being created as an empty room', () => {
  const { root, env } = setup();
  fs.mkdirSync(root, { recursive: true });
  new Database(dbPath(root)).close();
  assert.deepEqual(JSON.parse(status({ env: env('p1'), json: true })).members, []);
});

test('JSON status sets aside a database from another build and reads a fresh one', () => {
  const { root, env } = setup();
  fs.mkdirSync(root, { recursive: true });
  const client = new Database(dbPath(root));
  client.exec('PRAGMA user_version = 99');
  client.close();
  assert.deepEqual(JSON.parse(status({ env: env('p1'), json: true })).members, []);
  assert.ok(fs.readdirSync(root).some((f) => f.startsWith('chat.db.incompatible-')));
});
