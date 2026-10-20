import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli } from './run-cli.ts';

test('with no arguments, prints the help and points agents to guide', async () => {
  const { stdout, code } = await cli().run([]);
  expect(code).toBe(0);
  expect(stdout).toContain('Agent commands:');
  expect(stdout).toMatch(/Agents: run `.* guide` to learn how to use the room\./);
});

test('each command has help with its usage', async () => {
  const { run } = cli();
  for (const command of ['join', 'message', 'leave', 'guide', 'status', 'tick']) {
    const { stdout, code } = await run([command, '--help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(new RegExp(`Usage: .* ${command}\\b`));
  }
});

test('usage errors use standard errors without suggestions or examples', async () => {
  const { run } = cli();
  const option = await run(['status', '--histroy']);
  expect(option.code).toBe(1);
  expect(option.stderr).toContain("unknown option '--histroy'");
  expect(option.stderr).not.toContain('Did you mean');
  const command = await run(['mesage', 'hi']);
  expect(command.code).toBe(1);
  expect(command.stderr).toContain("unknown command 'mesage'");
  expect(command.stderr).not.toContain('Did you mean');
  const missing = await run(['join']);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toMatch(/Usage: .* join <agent>, or .* join --description/);
  expect(missing.stderr).not.toContain('Example:');
});

test("usage errors point to the command's own help", async () => {
  const { run } = cli();
  const option = await run(['message', '--to']);
  expect(option.code).toBe(1);
  expect(option.stderr).toMatch(/\(.* message --help shows its usage\)/);
  const root = await run(['--frob']);
  expect(root.code).toBe(1);
  expect(root.stderr).toMatch(/\(.* --help lists the commands\)/);
});

test('an unknown command lists the commands and answers the usual guesses', async () => {
  const { run } = cli();
  const typo = await run(['mesage', 'hi']);
  expect(typo.code).toBe(1);
  expect(typo.stderr).toContain(
    'Commands: join, message, guide, leave, invite, agents, status, help.',
  );
  expect(typo.stderr).toMatch(/Agents: run `.* guide`/);
  const inbox = await run(['inbox']);
  expect(inbox.code).toBe(1);
  expect(inbox.stderr).toContain('There is no inbox to read');
  const send = await run(['send', 'hi']);
  expect(send.stderr).toMatch(/To post, use message: .* message --to <handle> --stdin/);
  const who = await run(['members']);
  expect(who.stderr).toMatch(/Your handle and the members: .* guide\./);
});

test('help groups the commands by who runs them, and leaves out tick', async () => {
  const { run } = cli();
  const root = (await run(['--help'])).stdout;
  expect(root).toMatch(
    /Agent commands:\n {2}join[\s\S]*\n {2}message[\s\S]*\n {2}guide[\s\S]*\n {2}leave[\s\S]*\n\nUser commands:\n {2}invite[\s\S]*\n {2}agents[\s\S]*\n {2}status[\s\S]*\n {2}help/,
  );
  expect(root).not.toContain('tick');
  const join = (await run(['join', '--help'])).stdout;
  expect(join).toContain('--handle');
  expect(join).not.toMatch(/--agent|--model|--prompt|--as\b/);
  const invite = (await run(['invite', '--help'])).stdout;
  expect(invite).toMatch(/--pane[\s\S]*--agent[\s\S]*--model[\s\S]*--prompt/);
});

test('old forms are refused with the line to run instead', async () => {
  const { run } = cli();
  await run(['tick']);
  const as = await run(['join', '--as', 'reviewer'], { inPane: true });
  expect(as.code).toBe(1);
  expect(as.stderr).toMatch(/The agent is positional now: .* join reviewer/);
  const start = await run(['join', '--agent', 'codex', '--handle', 'r'], { inPane: true });
  expect(start.code).toBe(1);
  expect(start.stderr).toMatch(/Starting an agent moved to invite: .* invite <agent>/);
  const pane = await run(['invite', 'w1:p3', '--agent', 'codex'], { inPane: true });
  expect(pane.code).toBe(1);
  expect(pane.stderr).toMatch(/The pane is an option now: .* invite <agent> --pane w1:p3/);
  const skill = await run(['skill'], { inPane: true });
  expect(skill.code).toBe(1);
  expect(skill.stderr).toMatch(/skill is called guide now: .* guide/);
  const inviteAs = await run(['invite', '--as', 'reviewer'], { inPane: true });
  expect(inviteAs.stderr).toMatch(/The agent is positional now: .* invite reviewer/);
  const role = await run(['join', 'codex, reviews'], { inPane: true });
  expect(role.code).toBe(1);
  expect(role.stderr).toMatch(
    /No agent definition "codex, reviews" in .*\. For an ad-hoc join, use: .* join --description "<agent type>, <your role>"/,
  );
  expect(JSON.parse((await run(['status', '--json'], { inPane: true })).stdout).members).toEqual(
    [],
  );
});

test('--version prints the version', async () => {
  const { stdout, code } = await cli().run(['--version']);
  expect(code).toBe(0);
  expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("help in a member's pane starts with who it is and how to post", async () => {
  const { run, root } = cli();
  const before = await run(['--help'], { inPane: true });
  expect(before.stdout).toMatch(/^Usage:/);
  expect(fs.existsSync(path.join(root, 'state', 'hub', 'chat.db'))).toBe(false);
  await run(['tick']);
  await run(['join', '--description', 'codex, reviews'], { inPane: true });
  await run(['join', '--description', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  const help = await run([], { inPane: true });
  expect(help.stdout).toMatch(
    /^You are @codex in chat room "w1", with @claude\.\nPost: .* message --to <handle> --stdin .* rules: .* guide\n/,
  );
  expect((await run(['--help'], { inPane: true, paneId: 'p9' })).stdout).toMatch(/^Usage:/);
});

test('help in a pane leaves a database from another build as it is', async () => {
  const { run, root } = cli();
  const dir = path.join(root, 'state', 'hub');
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'chat.db'));
  db.exec('CREATE TABLE members (handle TEXT); PRAGMA user_version = 99;');
  db.close();
  const before = fs.readFileSync(path.join(dir, 'chat.db'));
  const help = await run(['--help'], { inPane: true });
  assert.match(help.stdout, /^Usage:/);
  assert.deepEqual(fs.readdirSync(dir), ['chat.db']);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'chat.db')), before);
});

test('room overrides are rejected and status requires a Herdr pane', async () => {
  const { run } = cli();
  const result = await run(['status', '--room', 'w2'], { inPane: true });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("unknown option '--room'");
  const outside = await run(['status']);
  expect(outside.code).toBe(1);
  expect(outside.stderr).toContain('inside a Herdr pane');
});

test('agent commands outside Herdr, or before joining, say what to do instead', async () => {
  const { run } = cli();
  await run(['tick']);
  const outside = await run(['message', 'hi']);
  expect(outside.code).toBe(1);
  expect(outside.stderr).toContain('must run inside a Herdr pane');
  const notJoined = await run(['message', 'hi'], { inPane: true });
  expect(notJoined.code).toBe(1);
  expect(notJoined.stderr).toMatch(
    /This pane has not joined the chat\. Run: .* join --description "/,
  );
  const guide = await run(['guide']);
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('Join only if your user asked you to');
});

test('join, message from stdin and tick work end to end against Herdr', async () => {
  const { run, prompts } = cli();
  await run(['tick']); // the plugin's first event
  const joined = await run(['join', '--description', 'codex, reviews'], { inPane: true });
  expect(joined.stdout).toContain('as @codex.');
  const alone = await run(['message', 'anyone?'], { inPane: true });
  expect(alone.code).toBe(1);
  expect(alone.stderr).toContain('there are no other agents in the room yet');
  await run(['join', '--description', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  const posted = await run(['message', '--stdin'], {
    inPane: true,
    stdin: 'line one\nline two\n',
  });
  expect(posted.stdout).toMatch(/^Queued as @codex for @claude\./);
  await run(['tick']);
  expect(prompts()).toContain('line one\nline two');
  expect((await run(['guide'], { inPane: true })).stdout).toContain(
    'You are @codex in chat room "w1"',
  );
});

test('message --attach, repeated, delivers the paths of copies of each file', async () => {
  const { run, prompts, root } = cli();
  const first = path.join(root, 'review.md');
  const second = path.join(root, 'trace.log');
  fs.writeFileSync(first, 'findings');
  fs.writeFileSync(second, 'trace');
  await run(['tick']);
  await run(['join', '--description', 'codex'], { inPane: true });
  await run(['join', '--description', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  const posted = await run(['message', '--attach', first, '--attach', second, 'see attached'], {
    inPane: true,
  });
  expect(posted.stdout).toMatch(/^Queued as @codex for @claude\./);
  await run(['tick']);
  const copies = [...prompts().matchAll(/^ {2}(\S+\/files\/codex-\S+)$/gm)].map((m) => m[1]!);
  expect(prompts()).toContain('see attached\n\nAttached:\n');
  expect(copies.map((p) => fs.readFileSync(p, 'utf8'))).toEqual(['findings', 'trace']);
});

test('status shows the room, its members and what ticks did', async () => {
  const { run } = cli();
  await run(['tick']);
  const empty = await run(['status'], { inPane: true });
  expect(empty.code).toBe(0);
  expect(empty.stdout).toContain('Members:\n  (none)');
  await run(['join', '--description', 'codex, reviews'], { inPane: true });
  await run(['join', '--description', 'claude, implements'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  await run(['message', 'hello there'], { inPane: true });
  await run(['tick']);
  const { stdout, code } = await run(['status'], { inPane: true });
  expect(code).toBe(0);
  expect(stdout).toContain('Room w1:');
  expect(stdout).toContain('@claude — claude, implements [claude, joined from p2]');
  // The notice that claude joined waits for codex's next message.
  expect(stdout).toContain('@codex — codex, reviews [codex, joined from p1; 1 message(s) waiting]');
  expect(stdout).toContain('m3 @codex → @claude: hello there');
  expect(stdout).toContain('→ delivered m3 to @claude');
});

test("tick --startup clears the session's rooms, but only when it knows the session", async () => {
  const unknown = cli();
  await unknown.run(['tick']);
  await unknown.run(['join', '--description', 'codex'], { inPane: true });
  await unknown.run(['tick', '--startup']);
  const kept = await unknown.run(['status'], { inPane: true });
  expect(kept.stdout).toContain('@codex');
  expect(kept.stdout).toContain('rooms were not cleared');

  const session = cli({ HERDR_SOCKET_PATH: '/tmp/herdr-test.sock' });
  await session.run(['tick']);
  await session.run(['join', '--description', 'codex'], { inPane: true });
  await session.run(['tick', '--startup']);
  const cleared = await session.run(['status'], { inPane: true });
  expect(cleared.stdout).toContain('Members:\n  (none)');
  expect(cleared.stdout).toContain('Herdr started: rooms cleared');
});

test('JSON status exposes room membership and draining handles without Herdr calls', async () => {
  const { run, calls } = cli();
  assert.equal((await run(['tick'])).code, 0);
  assert.equal(
    (await run(['join', '--handle', 'reviewer', '--description', 'reviews'], { inPane: true }))
      .code,
    0,
  );
  const before = calls().length;
  const pending = JSON.parse((await run(['status', '--json'], { inPane: true })).stdout);
  assert.equal(calls().length, before);
  assert.deepEqual(
    Object.keys(pending.members[0]).sort(),
    [
      'handle',
      'description',
      'pane_id',
      'joined_at',
      'status',
      'terminal_id',
      'agent',
      'reason',
      'held',
      'queuedFrom',
    ].sort(),
  );
  assert.equal(pending.room, 'w1');
  assert.equal(pending.members[0].handle, 'reviewer');
  assert.equal(pending.members[0].status, 'pending');
  assert.equal(pending.members[0].pane_id, 'p1');
  assert.equal((await run(['tick'])).code, 0);
  const afterTick = calls().length;
  assert.ok(afterTick > before, 'the fake records Herdr calls when a tick admits the member');
  assert.equal((await run(['leave'], { inPane: true })).code, 0);
  const left = JSON.parse((await run(['status', '--json'], { inPane: true })).stdout);
  assert.equal(calls().length, afterTick);
  assert.equal(left.members[0].status, 'left');
  assert.equal(typeof left.members[0].queuedFrom, 'boolean');
});
