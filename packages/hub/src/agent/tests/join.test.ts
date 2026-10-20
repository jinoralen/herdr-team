import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guide, join, leave, message } from '#agent';
import { installed, setup } from '#testing';

test('join registers the pane, assigns handles and returns instructions', async () => {
  const { joinAs, handles } = await installed();
  const out = await joinAs('w1:p1', 'claude reviewer');
  assert.match(out, /as @claude\./);
  assert.match(out, /herdr-hub message --to <handle> --stdin <<'EOF'/);
  const out2 = await joinAs('w1:p2', 'claude implementer');
  assert.match(out2, /as @claude-2\./);
  assert.match(out2, /@claude — claude reviewer/);
  assert.deepEqual(handles(), ['claude', 'claude-2']);
});

test('join is idempotent for the same pane', async () => {
  const { joinAs, handles } = await installed();
  await joinAs('w1:p1', 'codex');
  const again = await joinAs('w1:p1', 'codex something else');
  assert.match(again, /You are @codex in chat room/);
  assert.doesNotMatch(again, /When you.re done with what your user asked/);
  assert.deepEqual(handles(), ['codex']);
});

test('an explicit handle is exact, idempotent and cannot rename a joined pane', async () => {
  const { env, store } = await installed();
  const options = { description: 'reviews architecture', handle: 'reviewer', env: env('p1') };
  assert.match(join(options), /as @reviewer\./);
  assert.match(join(options), /You are @reviewer in chat room/);
  assert.throws(() => join({ ...options, handle: 'other' }), /already joined as @reviewer/);
  assert.throws(() => join({ ...options, env: env('p2') }), /already in use/);
  assert.equal(store().member('reviewer-2'), null);
  assert.equal(store().memberByPane('p2'), null);
});

test('invalid explicit handles fail without joining', async () => {
  const { env, store } = await installed();
  for (const handle of ['', '@reviewer', 'UPPER', '-reviewer', 'a'.repeat(21), 'two words']) {
    assert.throws(() => join({ description: 'reviewer', handle, env: env('p1') }), /A handle must/);
  }
  assert.equal(store().memberByPane('p1'), null);
});

test('confirmation recovers a terminal join rejected before agent detection', async () => {
  const { env, tick, herdr, store } = await installed();
  const options = { description: 'reviews architecture', handle: 'reviewer', env: env('p1') };
  join(options);
  await tick();
  assert.equal(store().member('reviewer')!.status, 'rejected');
  herdr.addAgent('p1', 'codex');
  assert.match(join(options), /as @reviewer\./);
  await tick();
  assert.equal(store().member('reviewer')!.status, 'active');
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

test('agent commands explain when herdr-team has never run (plugin not installed)', async () => {
  const { env } = setup();
  assert.throws(
    () => join({ description: 'x', env: env('w1:p1') }),
    /never run here[\s\S]*herdr plugin link/,
  );
});

test('commands refuse to run outside Herdr', async () => {
  const { root } = await installed();
  assert.throws(
    () => message({ text: 'hi', env: { HERDR_TEAM_STATE_DIR: path.dirname(root) } }),
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

// A herdr-team folder in the test's state directory, holding one definition.
function teamWith(root: string, name: string, text: string): string {
  const dir = path.join(root, 'team');
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agents', `${name}.md`), text);
  return dir;
}

const REVIEWER = `---
description: reviews architecture, read-only
kind: claude
---
Review architecture when the lead assigns work.
`;

test('join <agent> takes the handle, description and instructions from a definition', async () => {
  const { root, env, store, tick, herdr } = await installed();
  const team = teamWith(root, 'reviewer', REVIEWER);
  herdr.addAgent('p1', 'claude');
  herdr.addAgent('p2', 'codex');
  const out = join({ as: 'reviewer', env: { ...env('p1'), HERDR_TEAM_DIR: team } });
  assert.match(out, /as @reviewer\./);
  assert.match(
    out,
    /These rules again: .* guide\n\nYour instructions:\nReview architecture when the lead assigns work\./,
  );
  assert.equal(store().member('reviewer')?.description, 'reviews architecture, read-only');
  await tick();
  const peer = join({ description: 'codex', env: env('p2') });
  assert.match(peer, /@reviewer — reviews architecture, read-only/);
  assert.doesNotMatch(peer, /Your instructions/);
  assert.match(guide({ env: env('p1') }), /Your instructions:\nReview architecture/);
});

test('with an agent definition, the given handle and description override the definition', async () => {
  const { root, env, store, herdr } = await installed();
  const team = teamWith(root, 'reviewer', REVIEWER);
  for (const pane of ['p1', 'p2', 'p3']) {
    herdr.addAgent(pane, 'claude');
  }
  const as = (pane: string, extra = {}) =>
    join({ as: 'reviewer', ...extra, env: { ...env(pane), HERDR_TEAM_DIR: team } });
  assert.match(as('p1', { handle: 'arch', description: 'reviews the cache' }), /as @arch\./);
  assert.equal(store().member('arch')?.description, 'reviews the cache');
  assert.match(as('p2'), /as @reviewer\./);
  assert.match(
    as('p3'),
    /as @reviewer-2\./,
    "the definition's handle is a base, like a description's first word",
  );
  assert.equal(
    store().member('reviewer-2')?.instructions,
    'Review architecture when the lead assigns work.',
  );
});

test('join <agent> with a missing definition fails without joining', async () => {
  const { root, env, store } = await installed();
  const team = teamWith(root, 'reviewer', REVIEWER);
  assert.throws(
    () => join({ as: 'reviwer', env: { ...env('p1'), HERDR_TEAM_DIR: team } }),
    /No agent definition "reviwer" .* Definitions there: reviewer\./,
  );
  assert.equal(store().memberByPane('p1'), null);
});

test('instructions are stripped of terminal control sequences, like descriptions', async () => {
  const { root, env, store, herdr } = await installed();
  const team = teamWith(root, 'reviewer', `${REVIEWER}\x1b[2JThen clear.\x07\n`);
  herdr.addAgent('p1', 'claude');
  const out = join({ as: 'reviewer', env: { ...env('p1'), HERDR_TEAM_DIR: team } });
  const controls = (text: string): boolean => text.includes('\x1b') || text.includes('\x07');
  assert.equal(controls(out), false);
  assert.match(out, /lead assigns work\.\n\[2JThen clear\./);
  assert.equal(controls(guide({ env: env('p1') })), false);
  assert.equal(controls(store().member('reviewer')?.instructions ?? ''), false);
});

test('colliding generated handles stay within twenty characters', async () => {
  const { env, store } = await installed();
  const base = 'abcdefghijklmnopqrst';
  for (let n = 1; n <= 10; n++) {
    join({ description: base, env: env(`p${n}`) });
    const expected = n === 1 ? base : `${base.slice(0, 20 - `-${n}`.length)}-${n}`;
    assert.equal(store().memberByPane(`p${n}`)?.handle, expected);
  }
});
