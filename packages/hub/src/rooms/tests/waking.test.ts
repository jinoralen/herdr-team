import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { message } from '#agent';
import { installed } from '#testing';

test('a message without --to goes to every other agent', async () => {
  const { herdr, say, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  await say('p1', 'thoughts on the cache design?');
  assert.deepEqual(herdr.prompts.map((p) => p.pane).sort(), ['p2', 'p3']);
});

test('--to sends a message only to the agents named; nobody else ever gets it', async () => {
  const { herdr, env, tick, joinAs, settle } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  await joinAs('p4', 'opencode');
  message({ text: 'what about TTL?', to: ['codex', 'pi'], env: env('p1') });
  await tick();
  assert.deepEqual(herdr.prompts.map((p) => p.pane).sort(), ['p2', 'p3']);
  settle();
  message({ text: 'your view?', to: ['opencode'], env: env('p2') });
  await tick();
  const toOpencode = herdr.promptsTo('p4');
  assert.equal(toOpencode.length, 1);
  assert.match(toOpencode[0]!.text, /your view\?/);
  assert.doesNotMatch(toOpencode[0]!.text, /what about TTL/, 'not addressed to it');
});

test('text never addresses anyone: emails, scopes, decorators and @handles are just text', async () => {
  const { herdr, say, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  await say('p1', 'mail a@b.com, install @types/bun, use @Override, and @nobody');
  assert.deepEqual(herdr.prompts.map((p) => p.pane).sort(), ['p2', 'p3'], 'everyone, no refusal');
});

test('posting says who it is queued for, and reminds about --to when the text starts with @handle', async () => {
  const { env, joinAs } = await installed();
  await joinAs('p1', 'claude');
  assert.throws(
    () => message({ text: 'anyone?', env: env('p1') }),
    /^Error: Not queued: there are no other agents in the room yet/,
  );
  await joinAs('p2', 'codex');
  assert.match(
    message({ text: '@codex hi', env: env('p1') }),
    /^Queued as @claude for @codex\. It is sent/,
    'one other agent: no reminder needed',
  );
  await joinAs('p3', 'pi');
  assert.match(
    message({ text: 'hi all', env: env('p1') }),
    /^Queued as @claude for all agents in the room: @codex, @pi\. It is sent/,
  );
  assert.match(
    message({ text: 'hi', to: ['pi'], env: env('p1') }),
    /^Queued as @claude for @pi\. /,
  );
  assert.match(
    message({ text: '@pi can you check?', env: env('p1') }),
    /for all agents in the room: @codex, @pi\. Note: it starts with @pi but has no --to, so everyone gets it; to send only to @pi, use --to pi\./,
  );
});

test('--to naming someone who is not another member is refused, listing who is', async () => {
  const { env, joinAs, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  await joinAs('p3', 'pi');
  const before = store().queued('pi').length;
  for (const to of [['codx', 'pi'], ['claude'], []]) {
    assert.throws(
      () => message({ text: 'check this', to, env: env('p1') }),
      /^Error: Not queued: .*Members: @codex, @pi\. Fix --to and post again, or leave it out/,
      JSON.stringify(to),
    );
  }
  assert.match(
    (() => {
      try {
        message({ text: 'x', to: ['codx', 'pi'], env: env('p1') });
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })(),
    /@codx is not another member of the room/,
  );
  assert.equal(store().queued('pi').length, before, 'nothing was queued');
});

test('--fyi wakes nobody: it arrives with the next message, and its author is told so', async () => {
  const { herdr, env, tick, joinAs, settle, store } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  assert.match(
    message({ text: 'decision: keep the index. no reply needed', fyi: true, env: env('p1') }),
    /^Queued as @claude for @codex, as FYI: it wakes nobody and arrives with their next message\.$/,
  );
  await tick();
  assert.equal(herdr.prompts.length, 0, 'nobody woken');
  assert.equal(store().queued('codex')[0]!.kind, 'fyi');
  settle();
  message({ text: 'one more thing', env: env('p1') });
  await tick();
  assert.match(herdr.promptsTo('p2')[0]!.text, /\(FYI[^)]*\):\ndecision[\s\S]*one more thing/);
});

test('--re names the message being answered, and must be an id that was handed out', async () => {
  const { herdr, env, tick, joinAs } = await installed();
  await joinAs('p1', 'claude');
  await joinAs('p2', 'codex');
  message({ text: 'is the TTL right?', env: env('p1') }); // m3
  await tick();
  assert.match(
    message({ text: 'yes', re: 'm3', env: env('p2') }),
    /^Queued as @codex for @claude\./,
  );
  await tick();
  assert.match(herdr.promptsTo('p1')[0]!.text, /@codex \(re m3\):\nyes/);
  for (const re of ['m999', 'abc', '0']) {
    assert.throws(
      () => message({ text: 'x', re, env: env('p2') }),
      /^Error: Not queued: --re .* is not a message id/,
      re,
    );
  }
  assert.doesNotThrow(() => message({ text: 'also fine', re: '3', env: env('p2') }));
});
