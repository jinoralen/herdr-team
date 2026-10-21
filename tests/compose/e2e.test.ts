// Compose with the real hub and a fake herdr executable, run as processes: what compose.test.ts's
// in-memory hub can't show. Hub's prompt, the agent's kind and model, and exit codes.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { up } from '@herdr/compose';
import { fixture } from './fixture.ts';

test('helpers start through hub from their definition: kind, model, guide, instructions and task', async () => {
  const f = await fixture();
  await up(f);
  const calls = (await f.read()).calls;
  const start = calls.find((a) => a[1] === 'start' && a.includes('example-v1'))!;
  assert.deepEqual(start.slice(3, 5), ['--kind', 'codex']);
  assert.deepEqual(start.slice(-3), ['--', '--model', 'example-v1']);
  const prompt = calls.find((a) => a[1] === 'prompt' && a[3]?.includes('Review the code'))![3]!;
  assert.match(
    prompt,
    /as @reviewer\.[\s\S]*Your instructions:\nReview when asked\.[\s\S]*Your initial task:[\s\S]*Review the code/,
  );
  const hub = Bun.spawnSync([...command('hub'), 'status'], { env: f.env }).stdout.toString();
  assert.match(hub, /@reviewer — reviews the code/);
  await up(f);
  assert.equal((await f.read()).calls.filter((a) => a[1] === 'start').length, 2);
});

test('compose preserves Claude extended-context model aliases through hub startup', async () => {
  const f = await fixture();
  await f.define(
    'reviewer',
    '---\ndescription: reviews\nkind: claude\nmodel: sonnet[1m]\n---\nx\n',
  );
  await up(f);
  const start = (await f.read()).calls.find(
    (args) => args[1] === 'start' && args.includes('sonnet[1m]'),
  )!;
  assert.deepEqual(start.slice(-3), ['--', '--model', 'sonnet[1m]']);
});

test('the command line exits 75 while hub retires the old membership, and up works after a tick', async () => {
  const f = await fixture();
  await up(f);
  await f.write('Review security');
  const cli = Bun.spawn([...command('compose'), 'up', f.file], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(await cli.exited, 75, await new Response(cli.stderr).text());
  await f.tick();
  await up(f);
  assert.equal((await f.read()).calls.filter((a) => a[1] === 'start').length, 3);
});

test('up --dry-run --json replaces a helper whose hub state is gone', async () => {
  const f = await fixture();
  await up(f);
  fs.rmSync(path.join(f.root, 'state', 'hub'), { recursive: true });
  await f.tick();
  const cli = Bun.spawn([...command('compose'), 'up', f.file, '--dry-run', '--json'], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const planned = JSON.parse(await new Response(cli.stdout).text());
  assert.equal(await cli.exited, 0);
  assert.equal(planned.dryRun, true);
  assert.deepEqual(planned.changes[0], {
    action: 'replace',
    agent: 'reviewer',
    handle: 'reviewer',
    reasons: ['its conversation is gone'],
  });
});

// The hub or compose executable, as users run it.
function command(name: 'hub' | 'compose'): string[] {
  return process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, `herdr-${name}`)]
    : [process.execPath, fileURLToPath(import.meta.resolve(`@herdr/${name}/cli`))];
}
