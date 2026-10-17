// What agents' commands (and Herdr) may change while a pass is busy prompting someone else.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { join, leave, message } from '#agent';
import { Store } from '#store';
import { installed } from '#testing';

// A room with claude, codex and pi; pi posts to everyone, and `during` runs while the pass prompts
// claude, the first recipient (members are served in handle order), before it reaches codex.
async function whilePrompting(during: (ctx: Awaited<ReturnType<typeof installed>>) => void) {
  const ctx = await installed();
  const { herdr, joinAs, env } = ctx;
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  const real = herdr.prompt;
  let ran = false;
  herdr.prompt = async function (pane, text) {
    if (!ran) {
      ran = true;
      during(ctx);
    }
    return real.call(this, pane, text);
  };
  message({ text: 'for everyone', env: env('p3') }); // to claude, then codex
  await ctx.tick();
  herdr.prompt = real;
  return ctx;
}

test("a pass's outdated copy of a member can't undo a leave or a newer join", async () => {
  const { env, store, joinAs } = await installed();
  await joinAs('p1', 'claude');
  join({ description: 'codex', env: env('p2') });
  const pendingSnapshot = store().member('codex')!; // what a pass read
  leave({ env: env('p2') }); // meanwhile, the agent leaves
  assert.equal(store().admit(pendingSnapshot, { terminal_id: 't', agent: 'codex' }), false);
  assert.equal(store().reject(pendingSnapshot, 'x'), false);
  assert.equal(store().member('codex')!.status, 'left', 'not resurrected');
  const activeSnapshot = store().member('claude')!;
  leave({ env: env('p1') });
  assert.equal(store().setHeld(activeSnapshot, 'it is working'), false);
  assert.equal(store().remove(activeSnapshot, 'gone', 'gone'), null);
  assert.equal(store().member('claude')!.status, 'left');
  assert.equal(store().current(activeSnapshot), null);
});

test('a member that became busy while the pass was prompting someone else is not typed into', async () => {
  const { herdr, store, settle, tick } = await whilePrompting(({ herdr }) =>
    herdr.set('p2', { agent_status: 'working' }),
  );
  assert.equal(herdr.promptsTo('p1').length, 1);
  assert.equal(herdr.promptsTo('p2').length, 0, 'checked just before its prompt');
  assert.equal(store().member('codex')!.held, 'it is working');
  settle();
  await tick();
  assert.equal(herdr.promptsTo('p2').length, 1, 'delivered once idle');
});

test('a post from a join made while the pass was busy waits until the join is confirmed', async () => {
  const { herdr, store, tick } = await whilePrompting(({ env }) => {
    join({ description: 'ghost', env: env('p9') }); // Herdr sees no agent in p9
    message({ text: 'from an unconfirmed join', to: ['codex'], env: env('p9') });
  });
  assert.doesNotMatch(herdr.promptsTo('p2')[0]!.text, /unconfirmed join/);
  await tick(); // refuses the join
  assert.equal(store().member('ghost')!.status, 'rejected');
  assert.ok(!herdr.prompts.some((p) => /unconfirmed join/.test(p.text)), 'never delivered');
});

test('before typing, the batch is marked and its author warned, so a pass that dies mid-prompt leaves no silent re-send', async () => {
  const ctx = await installed();
  const { herdr, joinAs, say, store } = ctx;
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const seen: { unsure: string[]; warned: string[] }[] = [];
  const real = herdr.prompt;
  herdr.prompt = async function (pane, text) {
    seen.push({
      unsure: store()
        .queued('claude')
        .filter((q) => q.unsure)
        .map((q) => q.id),
      warned: store()
        .queued('codex')
        .filter((q) => q.kind === 'undelivered')
        .map((q) => q.text),
    });
    return real.call(this, pane, text);
  };
  await say('p2', 'hello');
  assert.deepEqual(seen[0]!.unsure, ['m2', 'm3'], 'marked while the prompt runs');
  assert.match(seen[0]!.warned[0]!, /Your message m3 to @claude may not have arrived/);
  assert.deepEqual(store().queued('claude'), [], 'delivered: dequeued');
  assert.deepEqual(store().queued('codex'), [], 'and the warning withdrawn');
});

test('an error in one room does not keep the others from being served', async () => {
  const { herdr, joinAs, env, tick, logs } = await installed();
  await joinAs('w1:p1', 'claude');
  await joinAs('w1:p2', 'codex');
  await joinAs('w2:p1', 'claude', 'claude', 'w2');
  await joinAs('w2:p2', 'pi', 'pi', 'w2');
  message({ text: 'w1 post', env: env('w1:p1') });
  message({ text: 'w2 post', env: env('w2:p1', 'w2') });
  const original = Store.prototype.members;
  Store.prototype.members = function (status) {
    if (this.room === 'w1') {
      throw new Error('database is locked');
    }
    return original.call(this, status);
  };
  try {
    await tick();
  } finally {
    Store.prototype.members = original;
  }
  assert.ok(logs.includes('error: database is locked'));
  assert.match(herdr.promptsTo('w2:p2')[0]!.text, /w2 post/);
  await tick();
  assert.match(herdr.promptsTo('w1:p2')[0]!.text, /w1 post/, 'served on the next pass');
});

test('a member that leaves while Herdr is being asked about its pane is not typed into', async () => {
  const { herdr, env, say, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const real = herdr.agent;
  herdr.agent = async function (pane) {
    leave({ env: env('p1') }); // e.g. claude ends a turn in which it ran leave
    return real.call(this, pane);
  };
  await say('p2', 'hello');
  herdr.agent = real;
  assert.equal(herdr.promptsTo('p1').length, 0);
  assert.equal(store().member('claude')!.status, 'left');
});

test('a new session found just before the prompt receives the message', async () => {
  const { herdr, say, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_session: { value: 's1' } });
  await say('p2', 'first'); // records s1
  herdr.set('p1', { agent_status: 'idle' });
  const real = herdr.agent;
  herdr.agent = async function (pane) {
    herdr.set('p1', { agent_session: { value: 's2' } }); // claude restarted meanwhile
    return real.call(this, pane);
  };
  await say('p2', 'second');
  herdr.agent = real;
  assert.equal(herdr.promptsTo('p1').length, 2, 'both sessions receive messages');
});

test('Herdr failing for one member does not stop delivery to the others', async () => {
  const { herdr, say, joinAs, logs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  const real = herdr.agent;
  herdr.agent = async function (pane) {
    if (pane === 'p1') {
      throw new Error('herdr agent get timed out');
    }
    return real.call(this, pane);
  };
  await say('p3', 'to everyone');
  herdr.agent = real;
  assert.ok(logs.includes('error delivering to @claude: herdr agent get timed out'));
  assert.equal(herdr.promptsTo('p2').length, 1, 'codex still served');
});

test('an agent disappearing just before delivery drops the message and warns its sender', async () => {
  const { herdr, say, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const real = herdr.agent;
  herdr.agent = async function (pane) {
    if (pane === 'p1') {
      herdr.set('p1', { agent: null });
    }
    return real.call(this, pane);
  };
  await say('p2', 'hello');
  assert.equal(herdr.promptsTo('p1').length, 0);
  assert.deepEqual(store().queued('claude'), []);
  assert.match(herdr.promptsTo('p2')[0]!.text, /could not be delivered/);
});
