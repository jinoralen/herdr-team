import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli } from './run-cli.ts';

const JOIN = [
  'invite',
  '--pane',
  'w2:p2',
  '--agent',
  'codex',
  '--handle',
  'reviewer',
  '--description',
  'reviews architecture',
];

async function remote(scenario = '') {
  // A herdr-team folder with one definition, for invite <agent>.
  const team = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-invite-'));
  onTestFinished(() => fs.rmSync(team, { recursive: true, force: true }));
  fs.mkdirSync(path.join(team, 'agents'));
  fs.writeFileSync(
    path.join(team, 'agents', 'reviewer.md'),
    '---\ndescription: reviews architecture\nkind: pi\nmodel: example-v1\n---\nReview when asked.\n',
  );
  const target = {
    pane_id: 'w2:p2',
    workspace_id: 'w2',
    terminal_id: 't2',
    agent: scenario === 'busy' ? 'claude' : null,
    agent_status: 'idle',
  };
  const fixture = cli(
    {
      HERDR_TEAM_DIR: team,
      // The caller is in w1; status without inPane can inspect the target room through this env.
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'other',
      HERDR_WORKSPACE_ID: 'w2',
    },
    {
      panes: scenario === 'missing' ? [] : [target],
      around: async (args, next) => {
        const command = `${args[0]} ${args[1]}`;
        if (command === 'agent start' && scenario === 'reject') {
          const result = await fixture.run(['tick']);
          assert.equal(result.code, 0, result.stderr);
        }
        if (command === 'agent prompt' && scenario === 'leave-on-prompt') {
          const result = await fixture.run(['leave'], {
            env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w2:p2', HERDR_WORKSPACE_ID: 'w2' },
          });
          assert.equal(result.code, 0, result.stderr);
        }
        const exited = next();
        if (command === 'agent start' && scenario === 'changed') {
          fixture.herdr().panes[0]!.terminal_id = 'other';
        }
        return exited;
      },
    },
  );
  const fail: Record<string, Record<string, string>> = {
    'start-timeout': { 'agent start': 'timeout' },
    'shell-starting': { 'agent start': 'agent_pane_busy' },
    'prompt-timeout': { 'agent prompt': 'timeout' },
  };
  fixture.herdr().fail = fail[scenario] ?? {};
  assert.equal((await fixture.run(['tick'])).code, 0);
  const calls = async (): Promise<string[][]> => fixture.calls();
  return { ...fixture, calls, team };
}

test('invite starts and confirms a target room member, submits its guide and preserves the caller', async () => {
  const { run, calls } = await remote();
  const result = await run(JOIN, { inPane: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /membership confirmed and guide submitted/);
  assert.match(result.stdout, /room w2/);
  const history = await calls();
  const start = history.find((args) => args[1] === 'start')!;
  assert.equal(start[2], 'reviewer-w2-p2');
  assert.deepEqual(start.slice(3), ['--kind', 'codex', '--pane', 'w2:p2', '--timeout', '120000']);
  const prompts = history.filter((args) => args[1] === 'prompt');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0]![2], 'w2:p2');
  assert.match(prompts[0]![3]!, /as @reviewer\./);
  assert.match(prompts[0]![3]!, /reviews architecture/);
  const target = await run(['status']);
  assert.match(target.stdout, /@reviewer — reviews architecture \[codex/);
  assert.doesNotMatch(target.stdout, /joining from/);
  assert.doesNotMatch((await run(['status'], { inPane: true })).stdout, /@reviewer/);
});

test('invite recovers when a startup tick rejects the initial shell join', async () => {
  const { run } = await remote('reject');
  const result = await run(JOIN, { inPane: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match((await run(['status'])).stdout, /@reviewer — reviews architecture \[codex/);
});

test('invite waits for a new pane shell to reach its prompt', async () => {
  const { run, calls } = await remote('shell-starting');
  const result = await run(JOIN, { inPane: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await calls()).filter((args) => args[1] === 'start').length, 2);
  assert.match((await run(['status'])).stdout, /@reviewer — reviews architecture \[codex/);
});

test('invite refuses occupied or missing panes without starting an agent', async () => {
  for (const scenario of ['busy', 'missing']) {
    const { run, calls } = await remote(scenario);
    const result = await run(JOIN, { inPane: true });
    assert.equal(result.code, 1);
    assert.equal(
      (await calls()).some((args) => args[1] === 'start'),
      false,
    );
    assert.doesNotMatch((await run(['status'])).stdout, /@reviewer/);
  }
});

test('invite startup and prompt uncertainty are reported once without retries or closing panes', async () => {
  for (const scenario of ['start-timeout', 'prompt-timeout', 'changed', 'leave-on-prompt']) {
    const { run, calls } = await remote(scenario);
    const result = await run(JOIN, { inPane: true });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Inspect the pane and room status before retrying/);
    const history = await calls();
    assert.equal(history.filter((args) => args[1] === 'start').length, 1);
    assert.equal(
      history.filter((args) => args[1] === 'prompt').length,
      ['prompt-timeout', 'leave-on-prompt'].includes(scenario) ? 1 : 0,
    );
    assert.equal(
      history.some((args) => args[1] === 'close'),
      false,
    );
  }
});

test('invite checks handle collisions before starting anything', async () => {
  const { run, calls } = await remote();
  assert.equal((await run(['join', '--handle', 'reviewer', '--description', 'existing'])).code, 0);
  const result = await run(JOIN, { inPane: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Handle @reviewer is already in use/);
  assert.equal(
    (await calls()).some((args) => args[1] === 'start'),
    false,
  );
});

test('join never calls Herdr, so it works inside agent sandboxes', async () => {
  const { run, calls } = await remote();
  const before = (await calls()).length;
  assert.equal((await run(['join', 'reviewer'], { inPane: true })).code, 0);
  assert.equal((await calls()).length, before);
});

test('join never starts agents in other panes: that is invite', async () => {
  const { run } = cli();
  const result = await run(['join', '--pane', 'w2:p2', '--description', 'reviews'], {
    inPane: true,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown option '--pane'/);
});

test('invite refuses a pane where an agent already runs, with the line to paste into it', async () => {
  const { run, calls } = await remote('busy');
  const result = await run(['invite', 'reviewer', '--pane', 'w2:p2'], { inPane: true });
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /w2:p2 already runs claude\. Ask it to run: .* join reviewer\nor invite a shell pane\./,
  );
  assert.equal(
    (await calls()).some((args) => args[1] === 'start'),
    false,
  );
});

test('invite <agent> --pane starts the definition in the target pane with its instructions', async () => {
  const { run, calls } = await remote();
  const result = await run([
    'invite',
    'reviewer',
    '--pane',
    'w2:p2',
    '--prompt',
    'Review the cache.',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const history = await calls();
  const start = history.find((args) => args[1] === 'start')!;
  assert.deepEqual(start.slice(3, 5), ['--kind', 'pi']);
  assert.deepEqual(start.slice(-3), ['--', '--model', 'example-v1']);
  const prompt = history.find((args) => args[1] === 'prompt')![3]!;
  assert.match(prompt, /as @reviewer\./);
  assert.match(
    prompt,
    /Your instructions:\nReview when asked\.[\s\S]*Your initial task:\nReview the cache\./,
  );
  assert.match((await run(['status'])).stdout, /@reviewer — reviews architecture \[pi/);
});

test('invite startup submits the guide followed by a multiline initial task', async () => {
  const { run, calls } = await remote();
  const task = 'Review caching.\nPreserve $(literal) and `text` 🚀.\x07';
  const result = await run([...JOIN, '--prompt', task], { inPane: true });
  assert.equal(result.code, 0, result.stderr);
  const prompt = (await calls()).find((args) => args[1] === 'prompt')![3]!;
  assert.ok(prompt.endsWith(`Your initial task:\n${task.replace('\x07', '')}`));
  assert.ok(prompt.indexOf('as @reviewer.') < prompt.indexOf('Your initial task:'));
  assert.doesNotMatch((await run(['status'])).stdout, /Review caching/);
});

test('invalid initial tasks fail before remote startup or membership changes', async () => {
  for (const task of ['  ', 'é'.repeat(40_001)]) {
    const { run, calls } = await remote();
    const result = await run([...JOIN, '--prompt', task], { inPane: true });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /initial prompt is empty|initial prompt exceeds 80 KB/);
    assert.equal((await calls()).length, 0);
    assert.doesNotMatch((await run(['status'])).stdout, /@reviewer/);
  }
});

test('oversized guides and initial tasks fail before remote startup or membership changes', async () => {
  const { run, calls, team } = await remote();
  fs.appendFileSync(path.join(team, 'agents', 'reviewer.md'), 'x'.repeat(30_000));
  const result = await run([
    'invite',
    'reviewer',
    '--pane',
    'w2:p2',
    '--prompt',
    'x'.repeat(75_000),
    '--json',
  ]);
  assert.equal(result.code, 1);
  const outcome = JSON.parse(result.stdout);
  assert.match(outcome.error, /exceed 100 KB/);
  assert.doesNotMatch((await run(['status'])).stdout, /joined/);
  assert.equal(outcome.uncertain, false);
  assert.equal(
    (await calls()).some((args) => args[1] === 'start'),
    false,
  );
  assert.doesNotMatch((await run(['status'])).stdout, /@reviewer/);
});

test('initial tasks are for invite: join takes none', async () => {
  const { run } = cli();
  const result = await run(['join', '--prompt', 'review', '--description', 'reviews'], {
    inPane: true,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown option '--prompt'/);
});

test('invite startup requires a description even with a handle and initial task', async () => {
  const { run, calls } = await remote();
  const args = JOIN.slice(0, -2);
  const result = await run([...args, '--prompt', 'Review caching'], { inPane: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires --description <text>, or an agent definition/);
  assert.equal((await calls()).length, 0);
});

test('invite startup forwards a model as harness arguments', async () => {
  const { run, calls } = await remote();
  const result = await run([...JOIN, '--model', 'example/model-v1']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await calls()).find((args) => args[1] === 'start')!.slice(-3), [
    '--',
    '--model',
    'example/model-v1',
  ]);
});

test('model selection is for invite and validates before changing membership', async () => {
  const { run, calls } = await remote();
  assert.match(
    (await run(['join', '--model', 'example', '--description', 'role'])).stderr,
    /unknown option '--model'/,
  );
  for (const model of [
    '',
    '--unsafe',
    'two words',
    'bad\nmodel',
    'bad\tmodel',
    'bad\x07model',
    'bad\x7fmodel',
  ]) {
    const result = await run([...JOIN, '--model', model]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /model identifier/);
  }
  assert.equal((await calls()).length, 0);
});

test('invite startup preserves Claude extended-context model aliases', async () => {
  for (const model of ['sonnet[1m]', 'opus[1m]']) {
    const { run, calls } = await remote();
    const args = JOIN.map((value) => (value === 'codex' ? 'claude' : value));
    const result = await run([...args, '--model', model]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual((await calls()).find((args) => args[1] === 'start')!.slice(-3), [
      '--',
      '--model',
      model,
    ]);
  }
});

test('invite --pane --json prints one JSON line, saying when the outcome is uncertain', async () => {
  const ok = await (await remote()).run([...JOIN, '--json'], { inPane: true });
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), {
    ok: true,
    agent: 'codex',
    handle: 'reviewer',
    pane: 'w2:p2',
    room: 'w2',
    uncertain: false,
  });
  for (const [scenario, uncertain] of [
    ['busy', false],
    ['prompt-timeout', true],
  ] as const) {
    const result = await (await remote(scenario)).run([...JOIN, '--json'], { inPane: true });
    assert.equal(result.code, 1);
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.uncertain, uncertain);
    assert.equal(typeof outcome.error, 'string');
  }
  const here = await cli().run(['invite', 'reviewer', '--json'], { inPane: true });
  assert.equal(here.code, 1);
  assert.match(here.stderr, /--json needs --pane/);
});
