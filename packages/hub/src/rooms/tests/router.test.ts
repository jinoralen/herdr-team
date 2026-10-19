import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HerdrError } from '@herdr/herdr';
import { join, message } from '#agent';
import { tick as initialize, Router } from '#rooms';
import { Store } from '#store';
import { fakeHerdr } from '#testing';

async function routing() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-routing-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const herdr = fakeHerdr();
  await initialize({ root, herdr });
  const env = (pane: string) => ({
    HERDR_ENV: '1',
    HERDR_PANE_ID: pane,
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_TEAM_STATE_DIR: root,
  });
  // Exercise routing in isolation. Production delivery is wired through locked passes later.
  async function pass() {
    const room = new Router({ root, room: 'w1', herdr });
    room.sync(await herdr.listPanes());
    await room.step();
    return room;
  }
  async function joinAs(pane: string, kind: string) {
    herdr.addAgent(pane, kind);
    join({ description: kind, env: env(pane) });
    await pass();
  }
  return { herdr, env, pass, joinAs, store: () => new Store(root, 'w1') };
}

test('the router admits genuine agents and delivers queued messages only to other members', async () => {
  const { herdr, env, pass, joinAs, store } = await routing();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  message({ text: 'review this\nsecond line', env: env('p1') });
  await pass();
  assert.equal(herdr.promptsTo('p1').length, 0);
  assert.match(herdr.promptsTo('p2')[0]!.text, /review this\nsecond line/);
  assert.deepEqual(store().queued('claude'), []);
  await pass();
  assert.equal(herdr.promptsTo('p2').length, 1, 'a delivered message is not replayed');
});

test('busy and blocked members wait without receiving prompts', async () => {
  const { herdr, env, pass, joinAs } = await routing();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  herdr.set('p2', { agent_status: 'blocked' });
  message({ text: 'wait for this', env: env('p1') });
  await pass();
  herdr.set('p2', { agent_status: 'working' });
  await pass();
  assert.equal(herdr.prompts.length, 0);
  herdr.set('p2', { agent_status: 'idle' });
  await pass();
  assert.equal(herdr.promptsTo('p2').length, 1);
});

test('uncertain prompts stay queued, marked, and are not resent on their own', async () => {
  const { herdr, env, pass, joinAs, store } = await routing();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  herdr.failNext = new HerdrError('timeout', 'possibly arrived');
  message({ text: 'do not resend automatically', env: env('p1') });
  await pass();
  await pass();
  assert.equal(herdr.promptsTo('p2').length, 0, 'not resent to claude');
  assert.deepEqual(
    store()
      .queued('claude')
      .map((q) => [q.id, q.unsure]),
    [['m3', true]],
  );
  assert.match(
    herdr.promptsTo('p1')[0]!.text,
    /Your message m3 to @claude may not have arrived/,
    'its author is told',
  );
});
