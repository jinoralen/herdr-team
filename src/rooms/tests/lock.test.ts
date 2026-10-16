import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { message } from '#agent';
import { tick as runTick, Service } from '#rooms';
import { serviceState } from '#store';
import { installed } from '#testing';

test('a tick that finds the lock taken asks the holder to run again, so nothing is missed', async () => {
  const { herdr, options, env, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  let release = () => {};
  const realList = herdr.listAgents;
  let first = true;
  herdr.listAgents = function () {
    if (!first) {
      return realList.call(this);
    }
    first = false;
    return new Promise((r) => {
      release = () => r(realList.call(this));
    });
  };
  const holder = runTick(options);
  await new Promise((r) => setImmediate(r));
  message({ text: 'posted while a pass was running', env: env('p1') });
  assert.equal(await tick(), false, 'second tick hands over instead of waiting');
  assert.equal(serviceState(options.root).dirty, true);
  release();
  assert.equal(await holder, true);
  assert.equal(herdr.promptsTo('p2').length, 1, 'the holder ran again and delivered the late post');
  assert.equal(serviceState(options.root).closed, true, 'lock released');
  assert.equal(serviceState(options.root).dirty, false);
});

test('a lock left by a crashed pass is taken over once its heartbeat is stale', async () => {
  const { root, herdr, say, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  // Took the lock 6s ago and never released or renewed it.
  assert.equal(new Service({ root, herdr, now: () => Date.now() - 6000 }).acquire(), true);
  await say('p2', 'after the crash');
  assert.equal(herdr.prompts.length, 1);
  assert.equal(serviceState(root).closed, true);
});

test('a pass that was waiting on Herdr when it lost the lock delivers nothing', async () => {
  const { root, herdr, say, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_status: 'working' });
  await say('p2', 'queued');
  herdr.set('p1', { agent_status: 'idle' });
  let release = () => {};
  const realList = herdr.listAgents;
  herdr.listAgents = function () {
    return new Promise((r) => {
      release = () => r(realList.call(this));
    });
  };
  const stale = new Service({ root, herdr });
  assert.equal(stale.acquire(), true);
  const pending = stale.load();
  await new Promise((r) => setImmediate(r));
  const other = new Service({ root, herdr, now: () => Date.now() + 6000 });
  assert.equal(other.acquire(), true, 'takes over the stale lock');
  release();
  await pending;
  await stale.step();
  assert.equal(stale.lost, true);
  assert.equal(herdr.prompts.length, 0, 'the old pass did not deliver after losing the lock');
  assert.equal(stale.release(), false);
  assert.equal(serviceState(root).owner, other.owner, "the new owner's lock is left alone");
  assert.equal(serviceState(root).closed, false);
});

test('a message posted while a delivery is under way is kept for the next one', async () => {
  const { herdr, env, say, joinAs, settle, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  const realPrompt = herdr.prompt;
  herdr.prompt = async function (pane, text) {
    message({ text: 'posted meanwhile', env: env('p2') });
    return realPrompt.call(this, pane, text);
  };
  await say('p2', 'first');
  herdr.prompt = realPrompt;
  assert.doesNotMatch(herdr.promptsTo('p1')[0]!.text, /posted meanwhile/);
  assert.deepEqual(
    store()
      .queued('claude')
      .map((q) => q.text),
    ['posted meanwhile'],
  );
  settle();
  await say('p2', 'second');
  assert.match(herdr.promptsTo('p1')[1]!.text, /posted meanwhile[\s\S]*second/);
});
