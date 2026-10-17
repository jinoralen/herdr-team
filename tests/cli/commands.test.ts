import { expect, test } from 'bun:test';
import { cli } from './run-cli.ts';

test('with no arguments, prints the help and points agents to skill', async () => {
  const { stdout, code } = await cli().run([]);
  expect(code).toBe(0);
  expect(stdout).toContain('Commands:');
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
