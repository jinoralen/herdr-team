import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { join, message, status } from '#agent';
import { installed } from '#testing';

test('each workspace gets its own room, served by the same ticks', async () => {
  const { herdr, tick, env, joinAs } = await installed();
  await joinAs('w1:p1', 'claude');
  await joinAs('w1:p2', 'codex');
  herdr.addAgent('w2:p1', 'claude');
  herdr.addAgent('w2:p2', 'pi');
  join({ description: 'claude', env: env('w2:p1', 'w2') });
  join({ description: 'pi', env: env('w2:p2', 'w2') });
  await tick();
  const out = join({ description: 'claude', env: env('w2:p1', 'w2') }); // instructions again, now with members
  assert.match(out, /as @claude\./, 'handles are per room');
  assert.match(out, /@pi — pi/);
  assert.doesNotMatch(out, /@codex/, 'members of other workspaces are not listed');

  message({ text: 'hello w2', env: env('w2:p1', 'w2') });
  await tick();
  assert.deepEqual(
    herdr.prompts.map((p) => p.pane),
    ['w2:p2'],
    'delivered only within the workspace',
  );
  assert.match(status({ env: env('w2:p1', 'w2') }), /hello w2/);
  assert.doesNotMatch(status({ env: env('w1:p1') }), /hello w2/);
});

test('a pane posts to the room of the workspace it joined from', async () => {
  const { env, joinAs } = await installed();
  await joinAs('w1:p1', 'claude');
  assert.throws(() => message({ text: 'hi', env: env('w1:p1', 'w2') }), /has not joined/);
});

test('ticks with no rooms do not call Herdr', async () => {
  const { herdr, tick } = await installed();
  let calls = 0;
  herdr.listPanes = async () => {
    calls++;
    return [];
  };
  await tick();
  await tick();
  assert.equal(calls, 0);
});
