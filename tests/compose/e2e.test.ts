// Compose with the real hub and a fake herdr executable, run as processes: what compose.test.ts's
// in-memory hub can't show. Hub's prompt, the agent's kind and model, and exit codes.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { up } from '@herdr/compose';
import { fixture } from './fixture.ts';

test('helpers start through hub from their definition: kind, model, guide, instructions and task', async () => {
  const f = await fixture();
  await up(f);
  const calls = f.read().calls;
  const start = calls.find((a) => a[1] === 'start' && a.includes('example-v1'))!;
  assert.equal(start[2], 'reviewer-pane2');
  assert.deepEqual(start.slice(3, 5), ['--kind', 'codex']);
  assert.deepEqual(start.slice(-3), ['--', '--model', 'example-v1']);
  const prompt = calls.find((a) => a[1] === 'prompt' && a[3]?.includes('Review the code'))![3]!;
  assert.match(
    prompt,
    /as @reviewer\.[\s\S]*Your instructions:\nReview when asked\.[\s\S]*Your initial task:[\s\S]*Review the code/,
  );
  const hub = Bun.spawnSync([...command('hub'), 'status'], { env: f.env }).stdout.toString();
  assert.match(hub, /@reviewer — reviews the code/);
  assert.ok(calls.some((a) => a[1] === 'prompt' && /Hub starts you as @lead/.test(a[3] ?? '')));
});

test('compose preserves Claude extended-context model aliases through hub startup', async () => {
  const f = await fixture();
  await f.define(
    'reviewer',
    '---\ndescription: reviews\nkind: claude\nmodel: sonnet[1m]\n---\nx\n',
  );
  await up(f);
  const start = f.read().calls.find((args) => args[1] === 'start' && args.includes('sonnet[1m]'))!;
  assert.deepEqual(start.slice(-3), ['--', '--model', 'sonnet[1m]']);
});

test('the command line exits 75 while hub retires the old membership', async () => {
  const f = await fixture();
  await up(f);
  await f.write('Review security');
  const cli = Bun.spawn([...command('compose'), 'up', f.file], {
    env: f.env,
    cwd: f.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(await cli.exited, 75, await new Response(cli.stderr).text());
  // The in-process lifecycle test covers ticking and retrying; this checks the real exit code.
});

// The hub or compose executable, as users run it.
function command(name: 'hub' | 'compose'): string[] {
  return process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, `herdr-${name}`)]
    : [process.execPath, fileURLToPath(import.meta.resolve(`@herdr/${name}/cli`))];
}
