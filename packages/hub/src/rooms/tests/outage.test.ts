import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { message } from '#agent';
import { installed } from '#testing';

test('an unavailable Herdr keeps the queue and releases the pass lock', async () => {
  const { herdr, env, tick, joinAs, store } = await installed();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  message({ text: 'keep this until Herdr returns', env: env('p1') });
  herdr.down = true;
  assert.equal(await tick(), true);
  assert.equal(store().queued('claude').length, 1);
  assert.equal(herdr.prompts.length, 0);
  herdr.down = false;
  assert.equal(await tick(), true);
  assert.deepEqual(store().queued('claude'), []);
  assert.match(herdr.promptsTo('p2')[0]!.text, /keep this until Herdr returns/);
});
