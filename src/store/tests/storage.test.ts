import { Database } from 'bun:sqlite';
import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbPath, readLog, rootDir, Store } from '#store';

function directory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-storage-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('rooms keep separate queues, ids are never reused, and a failed transaction rolls back', () => {
  const root = directory();
  const first = new Store(root, 'w1');
  const second = new Store(root, 'w2');
  const to = ['codex'];
  assert.equal(first.enqueue('claude', 'hello', to), 'm1');
  assert.equal(second.enqueue('claude', 'other room', to), 'm2');
  assert.deepEqual(
    new Store(root, 'w1').queued('codex').map((q) => [q.id, q.text]),
    [['m1', 'hello']],
  );
  first.dequeue('codex', ['m1']);
  assert.deepEqual(first.queued('codex'), []);
  assert.equal(
    first.enqueue('claude', 'again', to),
    'm3',
    'a delivered id is not handed out again',
  );
  assert.throws(() =>
    first.transaction(() => {
      first.enqueue('claude', 'rolled back', to);
      throw new Error('cancel transaction');
    }),
  );
  assert.deepEqual(
    first.queued('codex').map((q) => q.text),
    ['again'],
  );
  assert.equal(first.enqueue('claude', 'next', to), 'm4');
  assert.throws(() => new Store(root, '../invalid'), /Invalid room/);
});

test('a corrupt database is reported without replacing its bytes', () => {
  const root = directory();
  const bytes = 'not a database'.repeat(100);
  fs.writeFileSync(dbPath(root), bytes);
  assert.throws(() => new Store(root, 'w1'), /not a database/);
  assert.equal(fs.readFileSync(dbPath(root), 'utf8'), bytes);
});

test('a database from an incompatible build is set aside, and the hub starts fresh', () => {
  const root = directory();
  const old = new Database(dbPath(root));
  old.exec('CREATE TABLE inbox (id INTEGER); PRAGMA user_version = 2;');
  old.close();
  const store = new Store(root, 'w1');
  assert.equal(store.enqueue('claude', 'works', ['codex']), 'm1');
  const aside = fs.readdirSync(root).filter((f) => f.startsWith('chat.db.incompatible-'));
  assert.equal(aside.length, 1, fs.readdirSync(root).join());
  const kept = new Database(path.join(root, aside[0]!), { readonly: true });
  assert.ok(
    kept.query("SELECT name FROM sqlite_master WHERE name = 'inbox'").get(),
    'kept as it was',
  );
  kept.close();
  assert.match(
    readLog(root, 'w1', 5)[0]!.text,
    /incompatible herdr-agent-hub build.*Agents must join again/,
  );
});

test('replacing an incompatible database waits for the replace lock held by another process', async () => {
  const root = directory();
  const old = new Database(dbPath(root));
  old.exec('PRAGMA user_version = 2;');
  old.close();
  // Another process is replacing it: it holds the lock for a moment.
  const holder = Bun.spawn(
    [
      process.execPath,
      '-e',
      `const { Database } = require('bun:sqlite'); const l = new Database(${JSON.stringify(`${dbPath(root)}.replace-lock`)}); l.exec('BEGIN EXCLUSIVE'); console.log('held'); setTimeout(() => { l.exec('COMMIT'); l.close(); }, 300);`,
    ],
    { stdout: 'pipe' },
  );
  const reader = holder.stdout.getReader();
  await reader.read(); // "held"
  const started = Date.now();
  assert.equal(new Store(root, 'w1').enqueue('claude', 'works', ['codex']), 'm1');
  assert.ok(Date.now() - started >= 200, 'waited for the other process');
  await holder.exited;
  assert.equal(
    fs.readdirSync(root).filter((f) => /^chat\.db\.incompatible-[^-]+$/.test(f)).length,
    1,
    'set aside once',
  );
});

test('each Herdr session gets its own state directory; the default one uses the base', () => {
  const base = { HERDR_AGENT_HUB_DIR: '/tmp/hub' };
  const defaultSocket = path.join(os.homedir(), '.config', 'herdr', 'herdr.sock');
  assert.equal(rootDir(base), '/tmp/hub');
  assert.equal(rootDir({ ...base, HERDR_SOCKET_PATH: defaultSocket }), '/tmp/hub');
  const work = rootDir({ ...base, HERDR_SOCKET_PATH: '/tmp/herdr-work.sock' });
  const play = rootDir({ ...base, HERDR_SOCKET_PATH: '/tmp/herdr-play.sock' });
  assert.match(work, /^\/tmp\/hub\/session-[0-9a-f]+$/);
  assert.notEqual(work, play);
});
