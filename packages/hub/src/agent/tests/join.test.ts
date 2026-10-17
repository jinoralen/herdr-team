import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { join, leave, message } from '#agent';
import { installed, setup } from '#testing';

test('join registers the pane, assigns handles and returns instructions', async () => {
  const { joinAs, handles } = await installed();
  const out = await joinAs('w1:p1', 'claude reviewer');
  assert.match(out, /as @claude\./);
  assert.match(out, /herdr-agent-hub message --to <handle> --stdin <<'EOF'/);
  const out2 = await joinAs('w1:p2', 'claude implementer');
  assert.match(out2, /as @claude-2\./);
  assert.match(out2, /@claude — claude reviewer/);
  assert.deepEqual(handles(), ['claude', 'claude-2']);
});

test('join is idempotent for the same pane', async () => {
  const { joinAs, handles } = await installed();
  await joinAs('w1:p1', 'codex');
  const again = await joinAs('w1:p1', 'codex something else');
  assert.match(again, /as @codex\./);
  assert.deepEqual(handles(), ['codex']);
});

test('a joining agent can post before its turn ends; the post goes out once it is admitted', async () => {
  const { herdr, env, joinAs, tick } = await installed();
  await joinAs('p1', 'claude');
  herdr.addAgent('p2', 'codex');
  join({ description: 'codex', env: env('p2') });
  message({ text: 'hi from the new one', env: env('p2') }); // same turn, no tick in between
  await tick();
  assert.equal(herdr.promptsTo('p1').length, 1);
  assert.match(herdr.promptsTo('p1')[0]!.text, /@codex joined[\s\S]*hi from the new one/);
});

test('a join is refused when Herdr sees no agent in the pane, and the agent learns why', async () => {
  const { env, tick, logs } = await installed();
  join({ description: 'ghost', env: env('w1:p9') });
  await tick();
  assert.ok(logs.some((l) => typeof l === 'string' && /join rejected for @ghost/.test(l)));
  assert.throws(
    () => message({ text: 'hi', env: env('w1:p9') }),
    /join was refused: Herdr does not see a recognized agent/,
  );
});

test('agent commands explain when herdr-agent-hub has never run (plugin not installed)', async () => {
  const { env } = setup();
  assert.throws(
    () => join({ description: 'x', env: env('w1:p1') }),
    /never run here[\s\S]*herdr plugin link/,
  );
});

test('commands refuse to run outside Herdr', async () => {
  const { root } = await installed();
  assert.throws(
    () => message({ text: 'hi', env: { HERDR_AGENT_HUB_DIR: root } }),
    /inside a Herdr pane/,
  );
});

test('a handle is the first word of the description, cleaned up', async () => {
  const { joinAs } = await installed();
  assert.match(await joinAs('p3', 'All-Rounder, helps', 'pi'), /as @all-rounder\./);
  assert.match(await joinAs('p4', '!!!', 'opencode'), /as @agent\./);
});

test("a handle is not reused while the old member's messages still wait for delivery", async () => {
  const { herdr, env, say, joinAs, tick, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  herdr.set('p1', { agent_status: 'working' });
  await say('p2', 'before I go');
  leave({ env: env('p2') });
  herdr.addAgent('p3', 'codex');
  assert.match(join({ description: 'codex', env: env('p3') }), /as @codex-2\./);
  settle();
  herdr.set('p1', { agent_status: 'idle' });
  await tick();
  const text = herdr.promptsTo('p1')[0]!.text;
  assert.match(text, /before I go[\s\S]*@codex left the room[\s\S]*@codex-2 joined/);
  assert.match(
    join({ description: 'codex', env: env('p4') }),
    /as @codex\./,
    'free again once delivered',
  );
});

test('a description too long for a role is refused with a clear message', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  assert.throws(
    () => join({ description: `codex ${'a'.repeat(300)}`, env: env('p2') }),
    /^Error: The description is too long \(306 chars, max 200\)/,
  );
  assert.equal(store().member('codex'), null);
});

test("a description's control characters are stripped before others see it", async () => {
  const { joinAs } = await installed();
  await joinAs('w1:p1', 'claude \x1b[31mreviewer\x07');
  const out = await joinAs('w1:p2', 'codex');
  assert.match(out, /@claude — claude \[31mreviewer\n/);
});
