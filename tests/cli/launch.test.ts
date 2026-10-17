import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from './run-cli.ts';

const COMMAND = process.env.HERDR_TEST_BIN_DIR
  ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-agent-hub')]
  : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/hub/cli'))];

async function shell() {
  const fixture = cli();
  assert.equal((await fixture.run(['tick'])).code, 0);
  const result = path.join(fixture.root, 'launch.json');
  const harness = `#!${process.execPath}
await Bun.write(process.env.LAUNCH_RESULT, JSON.stringify({
  pid: process.pid, args: process.argv.slice(2), cwd: process.cwd(),
  pane: process.env.HERDR_PANE_ID, workspace: process.env.HERDR_WORKSPACE_ID,
  tty: !!process.stdin.isTTY, marker: process.env.LAUNCH_MARKER
}));
process.exit(23);
`;
  for (const agent of ['codex', 'claude', 'pi']) {
    const file = Bun.file(path.join(fixture.root, agent));
    await Bun.write(file, harness);
    fs.chmodSync(file.name!, 0o755);
  }
  await Bun.write(
    path.join(fixture.root, 'herdr'),
    `#!${process.execPath}
console.log(JSON.stringify({result: {pane: {
  pane_id: 'p1', terminal_id: 't1', agent: process.env.LIVE_AGENT || null, agent_status: 'idle'
}}}));
`,
  );
  const env = {
    PATH: `${fixture.root}:${process.env.PATH ?? ''}`,
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'p1',
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_AGENT_HUB_DIR: path.join(fixture.root, 'state'),
    HERDR_BIN_PATH: path.join(fixture.root, 'herdr'),
    LAUNCH_RESULT: result,
    LAUNCH_MARKER: 'preserved',
  };
  async function start(
    agent: string,
    extra: Record<string, string> = {},
    prompt?: string,
    model?: string,
  ) {
    const chunks: Buffer[] = [];
    const proc = Bun.spawn(
      [
        ...COMMAND,
        'join',
        '--agent',
        agent,
        '--handle',
        'reviewer',
        '--description',
        'reviews architecture',
        ...(prompt === undefined ? [] : ['--prompt', prompt]),
        ...(model === undefined ? [] : ['--model', model]),
      ],
      {
        env: { ...env, ...extra },
        cwd: fixture.root,
        timeout: 10000,
        terminal: {
          data: (_terminal, bytes) => {
            chunks.push(Buffer.from(bytes));
          },
        },
      },
    );
    try {
      const code = await proc.exited;
      return { pid: proc.pid, code, output: Buffer.concat(chunks).toString() };
    } finally {
      proc.terminal?.close();
    }
  }
  return { ...fixture, result, start };
}

test('terminal join hands the same process and terminal to each supported agent with its room guide', async () => {
  for (const agent of ['codex', 'claude', 'pi']) {
    const { start, result, root, run } = await shell();
    const launched = await start(agent);
    assert.equal(launched.code, 23, launched.output);
    const record = await Bun.file(result).json();
    assert.equal(record.pid, launched.pid);
    assert.equal(record.cwd, fs.realpathSync(root));
    assert.equal(record.tty, true);
    assert.equal(record.pane, 'p1');
    assert.equal(record.workspace, 'w1');
    assert.equal(record.marker, 'preserved');
    // Bun consumes the -- delimiter before passing argv to the fake harness script.
    assert.equal(record.args.length, 1);
    assert.match(record.args[0], /as @reviewer\./);
    assert.match(record.args[0], /join --handle .*reviewer/);
    assert.match(record.args[0], /reviews architecture/);
    assert.match((await run(['status'], { inPane: true })).stdout, /@reviewer/);
  }
});

test('terminal join refuses nested agents and unsupported kinds before joining', async () => {
  for (const [agent, env] of [
    ['codex', { LIVE_AGENT: 'claude' }],
    ['unknown', {}],
  ] as const) {
    const { start, run, result } = await shell();
    const launched = await start(agent, env);
    assert.equal(launched.code, 1);
    assert.equal(await Bun.file(result).exists(), false);
    assert.doesNotMatch((await run(['status'], { inPane: true })).stdout, /@reviewer/);
  }
});

test('terminal join requires an explicit handle and an interactive Herdr terminal', async () => {
  const { run } = cli();
  for (const [args, inPane] of [
    [['join', '--agent', 'codex', 'reviews'], true],
    [['join', '--agent', 'codex', '--handle', 'reviewer', 'reviews'], false],
    [['join', '--agent', 'codex', '--handle', 'reviewer', 'reviews'], true],
  ] as const) {
    const result = await run([...args], { inPane });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /requires --handle|inside a Herdr pane|interactive terminal/);
  }
});

test('a missing agent executable fails before registering the pane', async () => {
  const { start, root, result, run } = await shell();
  fs.unlinkSync(path.join(root, 'codex'));
  const launched = await start('codex', { PATH: root });
  assert.equal(launched.code, 1);
  assert.equal(await Bun.file(result).exists(), false);
  assert.doesNotMatch((await run(['status'], { inPane: true })).stdout, /@reviewer/);
});

test('same-pane startup appends the initial task after the guide without changing the role', async () => {
  const { start, result, run } = await shell();
  const task = 'Review the cache.\nKeep $(literal), `text`, and unicode 🚀 unchanged.';
  const launched = await start('codex', {}, task);
  assert.equal(launched.code, 23, launched.output);
  const { args } = await Bun.file(result).json();
  assert.ok(args[0].endsWith(`Your initial task:\n${task}`));
  assert.ok(args[0].indexOf('as @reviewer.') < args[0].indexOf('Your initial task:'));
  assert.doesNotMatch((await run(['status'], { inPane: true })).stdout, /Review the cache/);
});

test('terminal join forwards model selection before the initial prompt', async () => {
  for (const agent of ['codex', 'claude', 'pi']) {
    const { start, result } = await shell();
    const model = agent === 'claude' ? 'sonnet[1m]' : 'example-v1';
    const launched = await start(agent, {}, undefined, model);
    assert.equal(launched.code, 23, launched.output);
    const record = await Bun.file(result).json();
    assert.deepEqual(record.args.slice(0, 2), ['--model', model]);
    assert.match(record.args.at(-1), /as @reviewer/);
  }
});
