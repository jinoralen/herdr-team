import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { join, leave, message, status } from '#agent';
import { Store } from '#store';
import { installed, kinds } from '#testing';

test('a replacement agent and new session keep the pane membership', async () => {
  const { herdr, say, joinAs, handles } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent: 'pi', terminal_id: 'replacement', agent_session: { value: 'new' } });
  await say('p2', 'hello replacement');
  assert.deepEqual(handles(), ['claude', 'codex']);
  assert.match(herdr.promptsTo('p1')[0]!.text, /hello replacement/);
});

test('a closed pane is removed', async () => {
  const { herdr, tick, joinAs, handles } = await installed();
  await joinAs('p1', 'claude');
  herdr.agents = [];
  await tick();
  assert.deepEqual(handles(), []);
});

test('an empty pane keeps membership but drops messages and tells the sender', async () => {
  const { herdr, say, joinAs, tick, handles, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent: null, agent_status: 'unknown' });
  await say('p2', 'hello');
  assert.deepEqual(handles(), ['claude', 'codex']);
  assert.deepEqual(kinds(store(), 'claude'), ['joined'], 'the post is dropped; the notice waits');
  assert.match(herdr.promptsTo('p2')[0]!.text, /was not delivered: no agent is running/);
  herdr.set('p1', { agent: 'claude', agent_status: 'idle' });
  await tick();
  assert.equal(herdr.promptsTo('p1').length, 0, 'dropped message never reappears');
});

test('a pane moved to another workspace leaves its room', async () => {
  const { herdr, joinAs, tick, handles, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { pane_id: 'w2:p7' }); // same terminal, new workspace-qualified id
  await tick();
  assert.deepEqual(handles(), ['codex']);
  assert.match(
    store().queued('codex').at(-1)!.text,
    /@claude left: its pane moved to another workspace/,
  );
  assert.deepEqual(handles('w2'), [], 'not joined to the new workspace');
});

test('leave removes the member', async () => {
  const { env, joinAs, tick, handles } = await installed();
  await joinAs('p1', 'claude');
  leave({ env: env('p1') });
  await tick();
  assert.deepEqual(handles(), []);
});

test('a pane that has not joined cannot post', async () => {
  const { env, joinAs } = await installed();
  await joinAs('p1', 'claude');
  assert.throws(() => message({ text: 'hi', env: env('p5') }), /has not joined/);
});

test('a pass that fails keeps the queue for the next one', async () => {
  const { herdr, say, joinAs, tick, logs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const original = Store.prototype.queued;
  Store.prototype.queued = () => {
    throw new Error('disk full');
  };
  try {
    await say('p1', 'keep me');
  } finally {
    Store.prototype.queued = original;
  }
  assert.ok(
    logs.some((l) => /disk full/.test(l)),
    'the error is reported',
  );
  assert.equal(store().queued('codex').length, 1, 'still queued after a failed attempt');
  await tick();
  assert.match(herdr.promptsTo('p2')[0]!.text, /keep me/);
});

test('while Herdr is unreachable, posts wait, even from a member whose join is not confirmed yet', async () => {
  const { herdr, env, tick, joinAs, logs } = await installed();
  await joinAs('p2', 'claude');
  herdr.addAgent('p1', 'codex');
  join({ description: 'codex', env: env('p1') });
  message({ text: 'posted right after joining', env: env('p1') });
  herdr.down = true;
  await tick();
  assert.ok(logs.some((l) => l.includes('Deliveries wait')));
  assert.equal(herdr.prompts.length, 0);
  herdr.down = false;
  await tick();
  assert.match(herdr.promptsTo('p2')[0]!.text, /posted right after joining/);
});

test('posts from a refused join are dropped, and so is what waited for it', async () => {
  const { herdr, env, tick, joinAs, store } = await installed();
  await joinAs('p2', 'claude');
  join({ description: 'ghost', env: env('p9') }); // no agent in that pane
  message({ text: 'hello from nowhere', env: env('p9') });
  message({ text: 'welcome?', env: env('p2') });
  assert.equal(store().queued('ghost').length, 1, 'queued for the join that is still pending');
  await tick();
  assert.equal(store().member('ghost')!.status, 'rejected');
  assert.deepEqual(store().queued('claude'), []);
  assert.deepEqual(store().queued('ghost'), []);
  assert.equal(herdr.prompts.length, 0);
});

test('while Herdr is unreachable, an established room keeps posts for later', async () => {
  const { herdr, env, tick, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.down = true;
  message({ text: 'sent during the outage', env: env('p1') });
  await tick();
  assert.equal(herdr.promptsTo('p2').length, 0, 'nothing delivered while down');
  herdr.down = false;
  await tick();
  assert.match(herdr.promptsTo('p2')[0]!.text, /sent during the outage/);
});

test('FYI posts to an empty pane wait for a post, then are dropped with it', async () => {
  const { herdr, env, joinAs, tick, store, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  settle();
  herdr.set('p1', { agent: null });
  message({ text: 'FYI only', fyi: true, env: env('p2') });
  await tick();
  assert.deepEqual(kinds(store(), 'claude'), ['joined', 'joined', 'fyi'], 'an FYI wakes nobody');
  assert.equal(herdr.promptsTo('p2').length, 0);
  message({ text: '@claude question', env: env('p3') });
  await tick();
  assert.deepEqual(kinds(store(), 'claude'), ['joined', 'joined'], 'posts dropped; notices wait');
  assert.match(herdr.promptsTo('p2')[0]!.text, /was not delivered/);
  assert.match(herdr.promptsTo('p3')[0]!.text, /was not delivered/);
});

test('status shows the agent running in the pane now', async () => {
  const { herdr, joinAs, tick, env } = await installed();
  await joinAs('p1', 'claude');
  herdr.set('p1', { agent: 'pi' });
  await tick();
  assert.match(status({ env: env('p1') }), /@claude — claude \[pi,/);
  herdr.set('p1', { agent: null });
  await tick();
  assert.match(
    status({ env: env('p1') }),
    /@claude — claude \[pi,/,
    'an empty pane keeps the last',
  );
});

test('a busy or blocked replacement agent keeps its queued messages', async () => {
  const { herdr, say, joinAs, tick, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent: 'pi', agent_session: { value: 'new' }, agent_status: 'working' });
  await say('p2', 'one');
  herdr.set('p1', { agent_status: 'blocked' });
  await tick();
  assert.equal(herdr.promptsTo('p1').length, 0);
  assert.deepEqual(kinds(store(), 'claude'), ['joined', 'message'], 'kept, not dropped');
  herdr.set('p1', { agent_status: 'idle' });
  await tick();
  assert.match(herdr.promptsTo('p1')[0]!.text, /one/);
});

test('Herdr starting clears every room, and agents join again', async () => {
  const { joinAs, say, tick, handles, store, env } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await say('p2', 'before the restart');
  await tick({ startup: true });
  assert.deepEqual(handles(), []);
  assert.deepEqual(store().queued('claude'), []);
  assert.match(status({ env: env('p1') }), /Herdr started: rooms cleared/);
  assert.throws(() => message({ text: 'hi', env: env('p1') }), /has not joined/);
  join({ description: 'claude', env: env('p1') });
  await tick();
  assert.deepEqual(handles(), ['claude']);
});
