import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli } from './run-cli.ts';

test('with no arguments, prints the help and points agents to skill', async () => {
  const { stdout, code } = await cli().run([]);
  expect(code).toBe(0);
  expect(stdout).toContain('Agent commands:');
  expect(stdout).toMatch(/Agents: run `.* skill` to learn how to use the room\./);
});

test('each command has help with its usage', async () => {
  const { run } = cli();
  for (const command of ['join', 'message', 'leave', 'skill', 'status', 'tick']) {
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
  expect(missing.stderr).toContain("missing required argument 'description'");
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
  expect(typo.stderr).toContain('Commands: join, message, skill, leave, status, tick.');
  expect(typo.stderr).toMatch(/Agents: run `.* skill`/);
  const inbox = await run(['inbox']);
  expect(inbox.code).toBe(1);
  expect(inbox.stderr).toContain('There is no inbox to read');
  const send = await run(['send', 'hi']);
  expect(send.stderr).toMatch(/To post, use message: .* message --to <handle> --stdin/);
  const who = await run(['members']);
  expect(who.stderr).toMatch(/Your handle and the members: .* skill\./);
});

test('help separates the agent commands, and join the options only users start agents with', async () => {
  const { run } = cli();
  const root = (await run(['--help'])).stdout;
  expect(root).toMatch(/Agent commands:\n {2}join[\s\S]*message[\s\S]*skill[\s\S]*leave/);
  expect(root).toMatch(/Other commands:\n {2}status[\s\S]*tick[\s\S]*help/);
  const join = (await run(['join', '--help'])).stdout;
  const options = join.slice(join.indexOf('Options:'));
  const [own, starting] = options.split(
    'Starting an agent (run by the user from a shell, not by agents):',
  );
  expect(own).toContain('--handle');
  expect(own).not.toContain('--agent');
  expect(starting).toMatch(/--agent[\s\S]*--model[\s\S]*--pane[\s\S]*--prompt/);
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
  expect(fs.existsSync(path.join(root, 'state', 'chat.db'))).toBe(false);
  await run(['tick']);
  await run(['join', 'codex, reviews'], { inPane: true });
  await run(['join', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  const help = await run([], { inPane: true });
  expect(help.stdout).toMatch(
    /^You are @codex in chat room "w1", with @claude\.\nPost: .* message --to <handle> --stdin .* rules: .* skill\n/,
  );
  expect((await run(['--help'], { inPane: true, paneId: 'p9' })).stdout).toMatch(/^Usage:/);
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
  expect(notJoined.stderr).toMatch(/This pane has not joined the chat\. Run: .* join "/);
  const guide = await run(['skill']);
  expect(guide.code).toBe(0);
  expect(guide.stdout).toContain('Join only if your user asked you to');
});

test('join, message from stdin and tick work end to end against Herdr', async () => {
  const { run, prompts } = cli();
  await run(['tick']); // the plugin's first event
  const joined = await run(['join', 'codex, reviews'], { inPane: true });
  expect(joined.stdout).toContain('as @codex.');
  const alone = await run(['message', 'anyone?'], { inPane: true });
  expect(alone.code).toBe(1);
  expect(alone.stderr).toContain('there are no other agents in the room yet');
  await run(['join', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  const posted = await run(['message', '--stdin'], {
    inPane: true,
    stdin: 'line one\nline two\n',
  });
  expect(posted.stdout).toMatch(/^Queued as @codex for @claude\./);
  await run(['tick']);
  expect(prompts()).toContain('line one\nline two');
  expect((await run(['skill'], { inPane: true })).stdout).toContain(
    'You are @codex in chat room "w1"',
  );
});

test('status shows the room, its members and what ticks did', async () => {
  const { run } = cli();
  await run(['tick']);
  const empty = await run(['status'], { inPane: true });
  expect(empty.code).toBe(0);
  expect(empty.stdout).toContain('Members:\n  (none)');
  await run(['join', 'codex, reviews'], { inPane: true });
  await run(['join', 'claude, implements'], { inPane: true, paneId: 'p2' });
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
  await unknown.run(['join', 'codex'], { inPane: true });
  await unknown.run(['tick', '--startup']);
  const kept = await unknown.run(['status'], { inPane: true });
  expect(kept.stdout).toContain('@codex');
  expect(kept.stdout).toContain('rooms were not cleared');

  const session = cli({ HERDR_SOCKET_PATH: '/tmp/herdr-test.sock' });
  await session.run(['tick']);
  await session.run(['join', 'codex'], { inPane: true });
  await session.run(['tick', '--startup']);
  const cleared = await session.run(['status'], { inPane: true });
  expect(cleared.stdout).toContain('Members:\n  (none)');
  expect(cleared.stdout).toContain('Herdr started: rooms cleared');
});

test('JSON status exposes room membership and draining handles without Herdr calls', async () => {
  const { run } = cli();
  assert.equal((await run(['tick'])).code, 0);
  assert.equal((await run(['join', '--handle', 'reviewer', 'reviews'], { inPane: true })).code, 0);
  const pending = JSON.parse((await run(['status', '--json'], { inPane: true })).stdout);
  assert.equal(pending.room, 'w1');
  assert.equal(pending.members[0].handle, 'reviewer');
  assert.equal(pending.members[0].status, 'pending');
  assert.equal(pending.members[0].pane_id, 'p1');
  assert.equal((await run(['leave'], { inPane: true })).code, 0);
  const left = JSON.parse((await run(['status', '--json'], { inPane: true })).stdout);
  assert.equal(left.members[0].status, 'left');
  assert.equal(typeof left.members[0].queuedFrom, 'boolean');
});
