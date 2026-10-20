import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { guide } from '#agent';
import { installed } from '#testing';

test('guide gives a member its own guide again, and anyone else the general one', async () => {
  const { env, joinAs } = await installed();
  await joinAs('p1', 'claude reviewer');
  await joinAs('p2', 'codex implementer');
  const mine = guide({ env: env('p1') });
  assert.match(mine, /You are @claude in chat room "w1"/);
  assert.match(mine, /@codex — codex implementer/);
  assert.match(mine, /starting with "\[herdr-team to=@claude \.\.\.\]"/);
  assert.match(mine, /Answering a question is never --fyi/);
  assert.match(
    mine,
    /Only if a reply seems overdue: .* status says what waits and why\. Neither is an inbox/,
  );
  assert.doesNotMatch(
    mine,
    /When you're done with what your user asked/,
    'asking again is not joining',
  );
  const guest = guide({ env: env('p9') });
  assert.match(guest, /You are not in this workspace's room\. Join only if your user asked you to/);
  assert.match(
    guide({ env: {} }),
    /Join only if your user asked you to/,
    'works outside Herdr too',
  );
});
