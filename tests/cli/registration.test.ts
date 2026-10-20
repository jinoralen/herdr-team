import { expect, onTestFinished, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli } from './run-cli.ts';

test('register a pane, rediscover its handle and see it in its workspace status', async () => {
  const { run } = cli();
  await run(['tick']);
  const joined = await run(['join', '--description', 'codex, reviews'], { inPane: true });
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain('as @codex.');
  expect((await run(['tick'])).code).toBe(0);
  const again = await run(['join', '--description', 'codex, another description'], {
    inPane: true,
  });
  expect(again.code).toBe(0);
  expect(again.stdout).toContain('as @codex.');
  const guide = await run(['guide'], { inPane: true });
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('You are @codex in chat room "w1"');
  const status = await run(['status'], { inPane: true });
  expect(status.code).toBe(0);
  expect(status.stdout).toContain('m1 @codex joined (codex, reviews).');
});

test('registration rejects missing identity, empty descriptions and room overrides', async () => {
  const { run } = cli();
  await run(['tick']);
  const outside = await run(['join', '--description', 'codex']);
  expect(outside.code).toBe(1);
  expect(outside.stderr).toContain('inside a Herdr pane');
  const empty = await run(['join', '--description', '  '], { inPane: true });
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
  const guide = await run(['guide']);
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('Join only if your user asked you to');
});

test('an exact handle still draining exits 75 to retry later; one in use exits 1', async () => {
  const { run } = cli();
  await run(['tick']);
  await run(['join', '-d', 'codex'], { inPane: true });
  await run(['join', '-d', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  await run(['message', 'still queued'], { inPane: true });
  await run(['leave'], { inPane: true });
  const draining = await run(['join', '--handle', 'codex', '-d', 'reviews'], {
    inPane: true,
    paneId: 'p3',
  });
  expect(draining.code).toBe(75);
  expect(draining.stderr).toContain('Handle @codex still has undelivered posts');
  const taken = await run(['join', '--handle', 'claude', '-d', 'reviews'], {
    inPane: true,
    paneId: 'p3',
  });
  expect(taken.code).toBe(1);
  expect(taken.stderr).toContain('Handle @claude is already in use.');
});

test('-d is short for --description', async () => {
  const { run } = cli();
  await run(['tick']);
  const joined = await run(['join', '-d', 'codex, reviews'], { inPane: true });
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain('as @codex.');
});

test('an ad-hoc join takes its role from --description and its handle from --handle', async () => {
  const { run } = cli();
  await run(['tick']);
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
  expect(joined.stderr).toMatch(/Usage: .* join <agent>, or .* join --description/);
  expect((await run(['status'], { inPane: true })).stdout).not.toContain('@reviewer');
});

test('join <agent> reads a definition from the herdr-team folder', async () => {
  const team = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-cli-'));
  onTestFinished(() => fs.rmSync(team, { recursive: true, force: true }));
  fs.mkdirSync(path.join(team, 'agents'));
  fs.writeFileSync(
    path.join(team, 'agents', 'reviewer.md'),
    '---\ndescription: reviews architecture\nkind: codex\npermissions: [deny]\n---\nReview when asked.\n',
  );
  const { run } = cli({ HERDR_TEAM_DIR: team });
  await run(['tick']);
  const joined = await run(['join', 'reviewer'], { inPane: true });
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain('as @reviewer.');
  expect(joined.stdout).toContain('Your instructions:\nReview when asked.');
  const missing = await run(['join', 'nobody'], { inPane: true, paneId: 'p2' });
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('error: No agent definition "nobody"');
  expect(missing.stderr).toContain('Definitions there: reviewer.');
  expect(missing.stderr).toContain('For an ad-hoc join');
  fs.writeFileSync(path.join(team, 'agents', 'broken.md'), 'Review when asked.\n');
  const broken = await run(['join', 'broken'], { inPane: true, paneId: 'p2' });
  expect(broken.code).toBe(1);
  expect(broken.stderr).toContain('it must start with frontmatter');
  expect(broken.stderr).not.toContain('For an ad-hoc join');
});

test('agents lists the definitions, and what is wrong with the ones that cannot be used', async () => {
  const team = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-cli-'));
  onTestFinished(() => fs.rmSync(team, { recursive: true, force: true }));
  const { run } = cli({ HERDR_TEAM_DIR: team });
  expect((await run(['agents'])).stdout).toMatch(
    /^No agent definitions in .*agents\. Add <name>\.md/,
  );
  fs.mkdirSync(path.join(team, 'agents'));
  const write = (name: string, text: string) =>
    fs.writeFileSync(path.join(team, 'agents', `${name}.md`), text);
  write(
    'reviewer',
    '---\ndescription: reviews architecture\nkind: claude\nmodel: sonnet\n---\nx\n',
  );
  write('helper', '---\ndescription: helps\n---\nx\n');
  write('broken', '---\nkind: claude\n---\nx\n');
  const listed = await run(['agents']);
  expect(listed.code).toBe(0);
  expect(listed.stdout).toContain('  reviewer: @reviewer, claude / sonnet — reviews architecture');
  expect(listed.stdout).toContain('  helper: @helper, no kind: can join, not be started — helps');
  expect(listed.stdout).toMatch(/ {2}broken: Agent definition .*broken\.md: add a description/);
  const json = JSON.parse((await run(['agents', '--json'])).stdout);
  expect(json.agents.map((a: { name: string }) => a.name)).toEqual([
    'broken',
    'helper',
    'reviewer',
  ]);
  expect(json.agents[2]).toMatchObject({ handle: 'reviewer', kind: 'claude', model: 'sonnet' });
  expect(json.agents[0].problem).toContain('add a description');
});
