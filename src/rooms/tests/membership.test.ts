import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { join, leave, message } from '#agent';
import { Store } from '#store';
import { installed } from '#testing';

test('a closed or replaced pane is removed and never prompted', async () => {
  const { herdr, say, joinAs, handles } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  herdr.agents = herdr.agents.filter((a) => a.pane_id !== 'p1');
  herdr.addAgent('p1', 'claude', 'new-terminal'); // same pane id, new occupant
  await say('p3', '@all hello');
  assert.deepEqual(handles(), ['codex', 'pi']);
  assert.equal(herdr.promptsTo('p1').length, 0);
  assert.match(herdr.promptsTo('p2')[0]!.text, /@claude left/);
});

test('a different agent in the same terminal is removed', async () => {
  const { herdr, tick, joinAs, handles } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p2', { agent: 'pi' });
  await tick();
  assert.deepEqual(handles(), ['claude']);
});

test('a new session of the agent in the same terminal is removed', async () => {
  const { herdr, tick, joinAs, handles, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'pi');
  herdr.set('p2', { agent_session: null }); // not reported yet: kept
  await tick();
  herdr.set('p2', { agent_session: { value: 's1' } });
  await tick();
  assert.equal(store().member('pi')!.session, 's1', 'adopted once Herdr reports it');
  herdr.set('p2', { agent_session: { value: 's2' } }); // e.g. pi restarted in that pane
  await tick();
  assert.deepEqual(handles(), ['claude']);
  assert.match(store().queued('claude').at(-1)!.text, /@pi left: .*new session/);
});

test('a member Herdr has not recognized yet stays, and gets its messages once recognized', async () => {
  const { herdr, say, joinAs, tick, handles } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent: null, agent_status: 'unknown' }); // e.g. right after Herdr restarted
  await say('p2', 'hello');
  assert.deepEqual(handles(), ['claude', 'codex']);
  assert.equal(herdr.prompts.length, 0);
  herdr.set('p1', { agent: 'claude', agent_status: 'idle' });
  await tick();
  assert.equal(herdr.prompts.length, 1);
});

test('a moved pane keeps receiving under its new pane id, and can still post', async () => {
  const { herdr, say, joinAs, tick, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { pane_id: 'w2:p7' });
  await tick();
  await say('p1', '@codex hi'); // agent env still has the original pane id
  assert.equal(herdr.promptsTo('p2').length, 1);
  settle();
  await say('p2', '@claude ping');
  assert.equal(herdr.promptsTo('w2:p7').length, 1);
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
