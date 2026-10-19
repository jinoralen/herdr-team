import { expect, onTestFinished, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  expect(help.stdout).toContain('Agent commands:');
  const guide = await run(['skill']);
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('Join only if your user asked you to');
});

test('named descriptions work for ordinary joins and cannot be mixed with positional descriptions', async () => {
  const { run } = cli();
  await run(['tick']);
  const mixed = await run(['join', '--description', 'reviews', 'other role'], { inPane: true });
  expect(mixed.code).toBe(1);
  expect(mixed.stderr).toContain('Use either --description or a positional description');
  expect((await run(['status'], { inPane: true })).stdout).not.toContain('@reviews');
  const joined = await run(
    ['join', '--handle', 'reviewer', '--description', 'reviews architecture'],
    { inPane: true },
  );
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain('as @reviewer.');
  expect((await run(['status'], { inPane: true })).stdout).toContain('reviews architecture');
});

test('an explicit handle does not replace the required description', async () => {
  const { run } = cli();
  await run(['tick']);
  const joined = await run(['join', '--handle', 'reviewer'], { inPane: true });
  expect(joined.code).toBe(1);
  expect(joined.stderr).toContain("missing required argument 'description'");
  expect((await run(['status'], { inPane: true })).stdout).not.toContain('@reviewer');
});

test('join --as reads a definition from the herdr-team folder', async () => {
  const team = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-cli-'));
  onTestFinished(() => fs.rmSync(team, { recursive: true, force: true }));
  fs.mkdirSync(path.join(team, 'agents'));
  fs.writeFileSync(
    path.join(team, 'agents', 'reviewer.md'),
    '---\ndescription: reviews architecture\nkind: codex\npermissions: [deny]\n---\nReview when asked.\n',
  );
  const { run } = cli({ HERDR_TEAM_DIR: team });
  await run(['tick']);
  const joined = await run(['join', '--as', 'reviewer'], { inPane: true });
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain('as @reviewer.');
  expect(joined.stdout).toContain('Your instructions:\nReview when asked.');
  const missing = await run(['join', '--as', 'nobody'], { inPane: true, paneId: 'p2' });
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('error: No agent definition "nobody"');
  expect(missing.stderr).toContain('Definitions there: reviewer.');
});
