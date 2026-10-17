import { expect, test } from 'bun:test';
import { cli } from './run-cli.ts';

test('register a pane, rediscover its handle and see it in its workspace status', async () => {
  const { run } = cli();
  await run(['tick']);
  const joined = await run(['join', 'codex, reviews'], { inPane: true });
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain('as @codex.');
  expect((await run(['tick'])).code).toBe(0);
  const again = await run(['join', 'codex, another description'], { inPane: true });
  expect(again.code).toBe(0);
  expect(again.stdout).toContain('as @codex.');
  const guide = await run(['skill'], { inPane: true });
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('You are @codex in chat room "w1"');
  const status = await run(['status'], { inPane: true });
  expect(status.code).toBe(0);
  expect(status.stdout).toContain('m1 @codex joined (codex, reviews).');
});

test('registration rejects missing identity, empty descriptions and room overrides', async () => {
  const { run } = cli();
  await run(['tick']);
  const outside = await run(['join', 'codex']);
  expect(outside.code).toBe(1);
  expect(outside.stderr).toContain('inside a Herdr pane');
  const empty = await run(['join', '  '], { inPane: true });
  expect(empty.code).toBe(1);
  expect(empty.stderr).toContain('Usage:');
  const override = await run(['status', '--room', 'w2'], { inPane: true });
  expect(override.code).toBe(1);
  expect(override.stderr).toContain("unknown option '--room'");
});

test('help and guest instructions describe the room', async () => {
  const { run } = cli();
  await run(['tick']);
  const help = await run([]);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain('Commands:');
  const guide = await run(['skill']);
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('Join only if your user asked you to');
});
