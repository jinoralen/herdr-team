import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from './run-cli.ts';

const COMMAND = process.env.HERDR_TEST_BIN_DIR
  ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-team')]
  : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/hub/cli'))];
const JOIN = [
  'invite',
  'w2:p2',
  '--agent',
  'codex',
  '--handle',
  'reviewer',
  '--description',
  'reviews architecture',
];

async function remote(scenario = '') {
  // A herdr-team folder with one definition, for invite --as.
  const team = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-invite-'));
  onTestFinished(() => fs.rmSync(team, { recursive: true, force: true }));
  fs.mkdirSync(path.join(team, 'agents'));
  fs.writeFileSync(
    path.join(team, 'agents', 'reviewer.md'),
    '---\ndescription: reviews architecture\nkind: pi\nmodel: example-v1\n---\nReview when asked.\n',
  );
  const fixture = cli({
    HERDR_TEAM_DIR: team,
    SCENARIO: scenario,
    // The caller is in w1; status without inPane can inspect the target room through this env.
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'other',
    HERDR_WORKSPACE_ID: 'w2',
  });
  assert.equal((await fixture.run(['tick'])).code, 0);
  const callsFile = path.join(fixture.root, 'calls.jsonl');
  await Bun.write(
    path.join(fixture.root, 'herdr'),
    `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
const scenario = process.env.SCENARIO;
const state = ${JSON.stringify(path.join(fixture.root, 'agent.json'))};
const started = fs.existsSync(state);
const pane = { pane_id: 'w2:p2', workspace_id: 'w2', terminal_id: started && scenario === 'changed' ? 'other' : 't2',
  agent: started ? fs.readFileSync(state, 'utf8') : scenario === 'busy' ? 'claude' : null, agent_status: 'idle' };
const out = result => console.log(JSON.stringify({result}));
const fail = code => { console.error(JSON.stringify({error: {code, message: code}})); process.exit(1); };
if (args[0] === 'pane' && args[1] === 'list') out({panes: [pane]});
else if (args[0] === 'pane') {
  if (scenario === 'missing') fail('pane_not_found');
  out({pane});
} else if (args[1] === 'start') {
  if (scenario === 'start-timeout') fail('timeout');
  if (scenario === 'reject') {
    const tick = Bun.spawnSync([...${JSON.stringify(COMMAND)}, 'tick'], {env: process.env});
    if (tick.exitCode !== 0) process.exit(tick.exitCode);
  }
  fs.writeFileSync(state, args[args.indexOf('--kind') + 1]);
  out({agent: {...pane, agent: args[args.indexOf('--kind') + 1]}});
} else if (args[1] === 'prompt') {
  if (scenario === 'prompt-timeout') fail('timeout');
  if (scenario === 'leave-on-prompt') {
    Bun.spawnSync([...${JSON.stringify(COMMAND)}, 'leave'], {env: {...process.env, HERDR_ENV: '1', HERDR_PANE_ID: 'w2:p2', HERDR_WORKSPACE_ID: 'w2'}});
  }
  out({type: 'ok'});
}
`,
  );
  const calls = async (): Promise<string[][]> => {
    if (!(await Bun.file(callsFile).exists())) {
      return [];
    }
    return (await Bun.file(callsFile).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  };
  return { ...fixture, calls };
}

test('invite starts and confirms a target room member, submits its guide and preserves the caller', async () => {
  const { run, calls } = await remote();
  const result = await run(JOIN, { inPane: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /membership confirmed and guide submitted/);
  assert.match(result.stdout, /room w2/);
  const history = await calls();
  const start = history.find((args) => args[1] === 'start')!;
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
  assert.equal((await run(['join', '--handle', 'reviewer', 'existing'])).code, 0);
  const result = await run(JOIN, { inPane: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Handle @reviewer is already in use/);
  assert.equal(
    (await calls()).some((args) => args[1] === 'start'),
    false,
  );
});

test('join no longer starts agents in other panes: that is invite', async () => {
  const { run } = cli();
  const result = await run(['join', '--agent', 'codex', '--pane', 'w2:p2', 'reviews'], {
    inPane: true,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown option '--pane'/);
});

test('invite refuses a pane where an agent already runs, with the line to paste into it', async () => {
  const { run, calls } = await remote('busy');
  const result = await run(['invite', 'w2:p2', '--as', 'reviewer'], { inPane: true });
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /w2:p2 already runs claude\. Ask it to run: .* join --as reviewer\nor invite a shell pane\./,
  );
  assert.equal(
    (await calls()).some((args) => args[1] === 'start'),
    false,
  );
});

test('invite --as starts the definition in the target pane with its instructions', async () => {
  const { run, calls } = await remote();
  const result = await run([
    'invite',
    'w2:p2',
    '--as',
    'reviewer',
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

test('initial tasks require agent startup mode in join', async () => {
  const { run } = cli();
  const result = await run(['join', '--prompt', 'review', 'reviews'], { inPane: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--prompt requires --agent/);
});

test('invite startup requires a description even with a handle and initial task', async () => {
  const { run, calls } = await remote();
  const args = JOIN.slice(0, -2);
  const result = await run([...args, '--prompt', 'Review caching'], { inPane: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires --description <text>, or --as a definition/);
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

test('model selection requires startup and validates before changing membership', async () => {
  const { run, calls } = await remote();
  assert.match(
    (await run(['join', '--model', 'example', 'role'])).stderr,
    /--model requires --agent/,
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
