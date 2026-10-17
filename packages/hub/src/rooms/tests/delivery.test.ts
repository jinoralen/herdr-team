import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { HerdrError } from '@herdr/herdr';
import { message, status } from '#agent';
import type { Store } from '#store';
import { installed } from '#testing';

const unsureFor = (store: Store, handle: string): string[] =>
  store
    .queued(handle)
    .filter((q) => q.unsure)
    .map((q) => q.id);

test('busy agents are not prompted; messages are batched until idle', async () => {
  const { herdr, say, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_status: 'working' });
  await say('p2', 'one');
  await say('p2', 'two');
  assert.equal(herdr.prompts.length, 0);
  herdr.set('p1', { agent_status: 'done' });
  await tick();
  assert.equal(herdr.prompts.length, 1);
  assert.match(herdr.prompts[0]!.text, /one[\s\S]*two/);
});

test('blocked agents are held and never prompted', async () => {
  const { herdr, say, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_status: 'blocked' });
  await say('p2', 'hello');
  await tick();
  assert.equal(herdr.prompts.length, 0);
  herdr.set('p1', { agent_status: 'idle' });
  await tick();
  assert.equal(herdr.prompts.length, 1);
});

test('agent_blocked from prompt is retried later', async () => {
  const { herdr, say, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.failNext = new HerdrError('agent_blocked', 'blocked');
  await say('p2', 'hello');
  assert.equal(herdr.prompts.length, 0);
  await tick();
  assert.equal(herdr.prompts.length, 1, 'retried after agent_blocked');
  assert.match(herdr.prompts[0]!.text, /hello/);
  assert.doesNotMatch(herdr.prompts[0]!.text, /may not have reached you/);
});

test('a pane Herdr no longer knows gets nothing, and nothing is marked unsure', async () => {
  const { herdr, say, joinAs, tick, store, logs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.failNext = new HerdrError('agent_not_found', 'agent target p1 not found');
  await say('p2', 'hello');
  assert.ok(logs.includes('… @claude is no longer in Herdr; nothing was sent.'));
  assert.deepEqual(unsureFor(store(), 'claude'), []);
  await tick();
  assert.match(herdr.promptsTo('p1')[0]!.text, /hello/, 'delivered once the pane answers again');
});

test('an uncertain delivery is not resent; its author is told, and it is repeated with the next message', async () => {
  const { herdr, say, joinAs, tick, logs, store, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.failNext = new HerdrError('agent_prompt_stalled', 'no turn started');
  await say('p2', 'lost?');
  await tick();
  await tick();
  assert.equal(herdr.promptsTo('p1').length, 0, 'not resent on its own');
  assert.deepEqual(unsureFor(store(), 'claude'), ['m2', 'm3']);
  assert.match(
    herdr.promptsTo('p2')[0]!.text,
    /· Your message m3 to @claude may not have arrived: the delivery failed or was interrupted\./,
  );
  assert.ok(
    logs.some(
      (l) =>
        typeof l === 'string' &&
        l.includes('delivery of m2,m3 to @claude failed (agent_prompt_stalled'),
    ),
  );
  settle();
  await say('p2', 'next');
  const text = herdr.promptsTo('p1')[0]!.text;
  assert.match(text, /ids=m2,m3,m5\]/, 'm4 was the warning to codex');
  assert.match(text, /\(m3 may repeat/);
  assert.match(text, /lost\?[\s\S]*next/);
  assert.deepEqual(store().queued('claude'), [], 'dequeued once a delivery got through');
});

test('uncertain deliveries add up until one gets through', async () => {
  const { herdr, say, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.failNext = new HerdrError('timeout', 'timed out');
  await say('p2', 'one');
  herdr.failNext = new HerdrError('timeout', 'timed out');
  await say('p2', 'two');
  assert.deepEqual(unsureFor(store(), 'claude'), ['m2', 'm3', 'm5'], 'm4 was a warning to codex');
  await say('p2', 'three');
  const text = herdr.promptsTo('p1')[0]!.text;
  assert.match(text, /\(m3, m5 may repeat: an earlier delivery of them/);
  assert.match(text, /one[\s\S]*two[\s\S]*three/);
});

test('a queue too big for one prompt goes out in order over several deliveries', async () => {
  const { herdr, say, joinAs, settle, tick, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_status: 'working' });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await say('p2', `part ${n} ${'é'.repeat(15000)}`); // 2 bytes per char: ~30 KB each
  }
  herdr.set('p1', { agent_status: 'idle' });
  await tick();
  const first = herdr.promptsTo('p1')[0]!.text;
  assert.ok(Buffer.byteLength(first) <= 100_000, String(Buffer.byteLength(first)));
  assert.match(first, /part 1[\s\S]*part 3/);
  assert.doesNotMatch(first, /part 4/);
  for (let i = 0; i < 3; i++) {
    settle();
    await tick();
  }
  const all = herdr
    .promptsTo('p1')
    .map((p) => p.text)
    .join('\n');
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(all.split(`part ${n} `).length - 1, 1, `part ${n} delivered exactly once`);
  }
  assert.deepEqual(store().queued('claude'), [], 'everything delivered');
});

test('messages not yet delivered wait across passes; delivered ones are not replayed', async () => {
  const { herdr, tick, env, joinAs, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  message({ text: 'first', env: env('p1') });
  await tick();
  assert.equal(herdr.promptsTo('p2').length, 1);
  settle();
  herdr.set('p2', { agent_status: 'working' });
  message({ text: 'second', env: env('p1') });
  await tick();
  await tick();
  herdr.set('p2', { agent_status: 'idle' });
  await tick();
  const toCodex = herdr.promptsTo('p2');
  assert.equal(toCodex.length, 2);
  assert.match(toCodex[1]!.text, /second/);
  assert.doesNotMatch(toCodex[1]!.text, /first/, 'already delivered, not replayed');
  assert.equal(herdr.promptsTo('p1').length, 0, 'nothing replayed to the sender');
});

test('message ids are never reused', async () => {
  const { herdr, say, joinAs, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  for (const text of ['one', 'two', 'three']) {
    await say('p1', text);
    settle();
  }
  const ids = herdr.promptsTo('p2').flatMap((p) => p.text.match(/ids=([^\]]+)\]/)![1]!.split(','));
  assert.equal(new Set(ids).size, ids.length);
  assert.match(
    herdr
      .promptsTo('p2')
      .map((p) => p.text)
      .join(),
    /one[\s\S]*two[\s\S]*three/,
  );
});

test('the log says why messages are held, once per reason across passes, and whom posts went to', async () => {
  const { herdr, tick, env, joinAs, logs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  herdr.set('p2', { agent_status: 'working' });
  message({ text: '@codex question', to: ['codex'], env: env('p1') });
  await tick();
  await tick();
  await tick();
  const held = logs.filter((l) => typeof l === 'string' && l.startsWith('… holding'));
  assert.deepEqual(held, ['… holding 2 message(s) for @codex: it is working.']);
  assert.match(status({ env: env('p1') }), /@claude → @codex: @codex question/);
  herdr.set('p2', { agent_status: 'blocked' });
  await tick();
  assert.ok(
    logs.includes(
      '… holding 2 message(s) for @codex: waiting on an approval/question in its pane.',
    ),
  );
});

test('posts are handled in the order they were made', async () => {
  const { herdr, env, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  for (const n of [1, 2, 3]) {
    message({ text: `post ${n}`, env: env('p1') });
  }
  await tick();
  assert.match(herdr.promptsTo('p2')[0]!.text, /post 1[\s\S]*post 2[\s\S]*post 3/);
});

test('message text is preserved exactly: multiline, unicode, shell metacharacters', async () => {
  const { herdr, env, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const text = '@codex line1\n$(rm -rf ~) `id` \'quote\' "dq" ; | && 🚀 привет\n\ttab';
  message({ text, env: env('p1') });
  await tick();
  assert.ok(herdr.prompts[0]!.text.includes(text));
});

test('delivery header matches the prefix promised in the join instructions', async () => {
  const { herdr, env, joinAs, tick } = await installed();
  const instructions = await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const prefix = instructions.match(/starting with "(\[herdr-agent-hub to=@claude) \.\.\.\]"/)![1]!;
  message({ text: 'hi', env: env('p2') });
  await tick();
  const text = herdr.promptsTo('p1')[0]!.text;
  assert.ok(text.startsWith(`${prefix} ids=`), text);
  assert.match(text, /ids=m\d+(,m\d+)*\]/);
});

test('a warning is withdrawn once the post it is about gets through, and FYI posts get none', async () => {
  const { herdr, env, say, joinAs, store, settle, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p2', { agent_status: 'working' }); // the author is busy, so its warning waits
  herdr.failNext = new HerdrError('timeout', 'timed out');
  message({ text: 'important', env: env('p2') }); // m3
  message({ text: 'just so you know', fyi: true, env: env('p2') }); // m4
  await tick();
  assert.deepEqual(
    store()
      .queued('codex')
      .map((q) => [q.kind, q.re]),
    [['undelivered', 'm3']],
    'one warning, for the post; none for the FYI',
  );
  settle();
  await say('p2', 'next'); // m3 and m4 repeated with it, successfully
  assert.match(herdr.promptsTo('p1')[0]!.text, /m3, m4 may repeat/);
  assert.deepEqual(
    store()
      .queued('codex')
      .filter((q) => q.kind === 'undelivered'),
    [],
    'nothing left to warn about',
  );
});

test('a batch of many posts from one author can always be written ahead', async () => {
  const { herdr, env, joinAs, tick, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_status: 'working' });
  for (let i = 0; i < 3000; i++) {
    message({ text: 'x', env: env('p2') });
  }
  herdr.set('p1', { agent_status: 'idle' });
  await tick();
  assert.equal(herdr.promptsTo('p1').length, 1);
  assert.deepEqual(store().queued('claude'), []);
});
