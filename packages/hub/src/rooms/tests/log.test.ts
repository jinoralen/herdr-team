import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { appendLog, readLog } from '#store';
import { installed } from '#testing';

test('ticks log to the database for status, and the log is capped', async () => {
  const { root } = await installed();
  appendLog(root, 'w1', 'a note');
  appendLog(root, null, 'about every room');
  appendLog(root, 'w2', 'another room');
  assert.deepEqual(
    readLog(root, 'w1', 10).map((r) => [r.room, r.text]),
    [
      ['w1', 'a note'],
      [null, 'about every room'],
    ],
  );
  for (let i = 0; i < 5010; i++) {
    appendLog(root, 'w1', `n${i}`);
  }
  assert.equal(readLog(root, 'w1', 10000).length, 5000);
  assert.equal(
    readLog(root, 'w1', 2)
      .map((r) => r.text)
      .join(),
    'n5008,n5009',
  );
});
