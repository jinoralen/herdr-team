import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLog, readLog, serviceState } from '#store';
import { PassLock } from '../pass-lock.ts';

function locks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-lock-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = Date.now();
  const first = new PassLock(root, () => now);
  const second = new PassLock(root, () => now);
  return {
    root,
    first,
    second,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('competing ticks request one more pass before ownership is released', () => {
  const { root, first, second } = locks();
  assert.equal(first.take(), true);
  assert.equal(second.take(), false);
  assert.equal(serviceState(root).dirty, true);
  assert.equal(first.release(), 'again');
  assert.equal(serviceState(root).closed, false, 'kept for the extra pass');
  assert.equal(first.release(), 'released');
  assert.equal(serviceState(root).closed, true);
  assert.equal(second.take(), true);
});

test('renewal protects a live lock and stale owners cannot release a successor', () => {
  const { root, first, second, advance } = locks();
  assert.equal(first.take(), true);
  advance(4000);
  first.renew();
  advance(4000);
  assert.equal(second.take(), false, 'the renewed heartbeat is still live');
  advance(6000);
  assert.equal(second.take(), true);
  assert.equal(first.owns(), false);
  assert.equal(first.release(), 'lost');
  assert.equal(serviceState(root).owner, second.owner);
  assert.equal(serviceState(root).closed, false);
});

test('persisted logs keep workspace identity', () => {
  const { root } = locks();
  appendLog(root, 'w1', 'first');
  appendLog(root, 'w2', 'second');
  appendLog(root, null, 'everyone');
  assert.deepEqual(
    readLog(root, 'w2', 10).map((row) => [row.room, row.text]),
    [
      ['w2', 'second'],
      [null, 'everyone'],
    ],
  );
});
