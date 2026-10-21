import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { down, status, teams, up } from '@herdr/compose';
import { fixture } from './fixture.ts';

test('up starts through hub, keeps healthy conversations and moves layout without restarting', async () => {
  const f = await fixture();
  await up(f);
  let history = (await f.read()).calls;
  assert.equal(history.filter((a: string[]) => a[1] === 'start').length, 1);
  assert.deepEqual(history.find((a: string[]) => a[1] === 'start')!.slice(-3), [
    '--',
    '--model',
    'example-v1',
  ]);
  assert.match(
    history.find((a: string[]) => a[1] === 'prompt')![3]!,
    /Your initial task:[\s\S]*Review the code/,
  );
  await up(f);
  await f.write('Review the code', 'rows');
  await up(f);
  history = (await f.read()).calls;
  assert.equal(history.filter((a: string[]) => a[1] === 'start').length, 1);
  assert.equal(history.filter((a: string[]) => a[1] === 'prompt').length, 1);
  assert.ok(fs.existsSync(path.join(f.root, 'state', 'compose', 'compose.db')));
  assert.ok(fs.existsSync(path.join(f.root, 'state', 'hub', 'chat.db')));
});

test('changed purpose waits for hub to retire the old membership before replacing', async () => {
  const f = await fixture();
  await up(f);
  await f.write('Review security');
  await assert.rejects(up(f), /occupied|draining/);
  // Retrying after a tick fixes it, so the command line says so with EX_TEMPFAIL.
  const cli = Bun.spawn([...(await composeCommand()), 'up', f.file], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(await cli.exited, 75, await new Response(cli.stderr).text());
  assert.equal((await f.read()).panes.filter((p) => p.agent === 'codex').length, 1);
  await f.tick();
  await up(f);
  assert.equal((await f.read()).calls.filter((a: string[]) => a[1] === 'start').length, 2);
}, 10_000);

test('down retains unrelated panes and ownership survives hub state removal', async () => {
  const f = await fixture();
  await up(f);
  const state = await f.read();
  const tab = state.panes.find((p: { pane_id: string }) => p.pane_id !== 'lead')!.tab_id;
  await f.change({
    panes: [
      ...state.panes,
      {
        pane_id: 'foreign',
        terminal_id: 'foreign-t',
        workspace_id: 'w1',
        tab_id: tab,
        agent: null,
        agent_status: 'idle',
      },
    ],
  });
  fs.rmSync(path.join(f.root, 'state', 'hub'), { recursive: true });
  await down(f);
  assert.deepEqual((await f.read()).panes.map((p: { pane_id: string }) => p.pane_id).sort(), [
    'foreign',
    'lead',
  ]);
  assert.match(await down(f), /already down/);
});

test('invalid manifests make no layout changes', async () => {
  const f = await fixture();
  await Bun.write(f.file, 'name: test\nagents: broken');
  await assert.rejects(up(f), /Invalid team YAML/);
  assert.equal(
    (await f.read()).calls.some((a: string[]) => ['create', 'start', 'close'].includes(a[1]!)),
    false,
  );
});

for (const [name, replacement, error] of [
  [
    'duplicate handles',
    '    handle: reviewer\n    tab: helpers\n  duplicate:\n    use: reviewer\n    handle: reviewer\n    tab: helpers',
    /Handle @reviewer is used by more than one agent/,
  ],
  ['unknown tab', '    tab: missing', /Agent reviewer names unknown tab missing/],
  [
    'missing cwd',
    '    tab: helpers\n    cwd: missing-directory',
    /Working directory .*missing-directory is missing or is not a directory/,
  ],
] as const) {
  test(`${name} is rejected before any layout or agent changes`, async () => {
    const f = await fixture();
    await Bun.write(
      f.file,
      (await Bun.file(f.file).text()).replace('    tab: helpers', replacement),
    );
    await assert.rejects(up(f), error);
    assert.equal(
      (await f.read()).calls.some((a) => ['create', 'start', 'close'].includes(a[1]!)),
      false,
    );
  });
}

for (const retry of ['up', 'down'] as const) {
  test(`a rejected tab creation does not block the next ${retry}`, async () => {
    const f = await fixture();
    await f.change({ rejectCreate: true });
    await assert.rejects(up(f), /refused/);
    if (retry === 'up') {
      await up(f);
      assert.equal((await f.read()).panes.length, 2);
    } else {
      await down(f);
      assert.deepEqual(
        (await f.read()).panes.map((p) => p.pane_id),
        ['lead'],
      );
      assert.match(await down(f), /already down/);
    }
  });
}

test('lost allocation responses are recovered before retrying up', async () => {
  const f = await fixture();
  await f.change({ failCreate: true });
  await assert.rejects(up(f), /timeout/);
  await up(f);
  const state = await f.read();
  assert.equal(state.panes.length, 2);
  assert.equal(state.calls.filter((a: string[]) => a[1] === 'start').length, 1);
});

test('uncertain startup prompts are never repeated into the same conversation', async () => {
  const f = await fixture();
  await f.change({ failPrompt: true });
  await assert.rejects(up(f), /Inspect the pane/);
  await assert.rejects(up(f), /occupied|draining/);
  await f.tick();
  await up(f);
  const prompts = (await f.read()).calls.filter((a: string[]) => a[1] === 'prompt');
  assert.equal(prompts.length, 2);
  assert.notEqual(prompts[0]![2], prompts[1]![2]);
});

test('shared context is resolved before changes and changing it replaces the helper', async () => {
  const f = await fixture();
  const yaml = await Bun.file(f.file).text();
  await Bun.write(f.file, `${yaml}shared:\n  files: [context.md]\n`);
  await assert.rejects(up(f), /No such file|ENOENT/);
  assert.equal((await f.read()).panes.length, 1);
  await Bun.write(path.join(f.root, 'context.md'), 'First brief');
  await up(f);
  await Bun.write(path.join(f.root, 'context.md'), 'Second brief');
  await assert.rejects(up(f), /occupied|draining/);
  await f.tick();
  await up(f);
  const prompts = (await f.read()).calls.filter((a) => a[1] === 'prompt');
  assert.match(prompts.at(-1)![3]!, /Second brief/);
});

test('colliding deployments do not close or start any additional helpers', async () => {
  const f = await fixture();
  await up(f);
  const before = (await f.read()).calls.filter((a) => ['start', 'close'].includes(a[1]!)).length;
  await Bun.write(f.file, (await Bun.file(f.file).text()).replace('name: test', 'name: other'));
  await assert.rejects(up(f), /occupied/);
  assert.equal(
    (await f.read()).calls.filter((a) => ['start', 'close'].includes(a[1]!)).length,
    before,
  );
});

test('status reports ownership without Herdr access and down needs no context files', async () => {
  const f = await fixture();
  await up(f);
  const before = (await f.read()).calls.length;
  assert.match(status({ env: f.env }), /reviewer=@reviewer \(ready; room: \w+\)/);
  assert.equal((await f.read()).calls.length, before);
  await Bun.write(f.file, 'name: test\nshared:\n  files: [missing.md]\n');
  await down(f);
  assert.match(status({ env: f.env }), /No deployments/);
});

test('shell bootstrap delegates the lead to hub and keeps the lead outside ownership', async () => {
  const f = await fixture();
  const state = await f.read();
  state.panes[0]!.agent = null;
  await f.change({ panes: state.panes });
  const result = await up({ ...f, interactive: true });
  assert.equal(result.launch?.kind, 'codex');
  assert.match(result.launch!.prompt, /Hub starts you as @lead/);
  await down(f);
  assert.equal((await f.read()).panes[0]!.pane_id, 'lead');
});

test('compose preserves Claude extended-context model aliases through hub startup', async () => {
  const f = await fixture();
  await f.define(
    'reviewer',
    '---\ndescription: reviews\nkind: claude\nmodel: sonnet[1m]\n---\nx\n',
  );
  await up(f);
  const start = (await f.read()).calls.find((args) => args[1] === 'start')!;
  assert.deepEqual(start.slice(-3), ['--', '--model', 'sonnet[1m]']);
});

for (const swap of [false, true]) {
  test(`${swap ? 'swapping' : 'reassigning'} owned handles retires helpers before waiting for reuse`, async () => {
    const f = await fixture();
    const original = await Bun.file(f.file).text();
    const auditor = '  auditor:\n    use: reviewer\n    tab: helpers\n';
    await Bun.write(f.file, original + auditor);
    await up(f);
    const changed = original.replace(
      '    use: reviewer\n    tab: helpers',
      '    use: reviewer\n    handle: auditor\n    tab: helpers',
    );
    await Bun.write(
      f.file,
      changed +
        (swap ? auditor.replace('    tab: helpers', '    handle: reviewer\n    tab: helpers') : ''),
    );
    await assert.rejects(up(f), /occupied|draining/);
    assert.deepEqual(
      (await f.read()).panes.filter((p) => p.agent).map((p) => p.pane_id),
      ['lead'],
    );
    await f.tick();
    await up(f);
    assert.match(status({ env: f.env }), /reviewer=@auditor \(ready; room: \w+\)/);
    if (swap) {
      assert.match(status({ env: f.env }), /auditor=@reviewer \(ready; room: \w+\)/);
    }
    const starts = (await f.read()).calls.filter((args) => args[1] === 'start').length;
    await up(f);
    assert.equal((await f.read()).calls.filter((args) => args[1] === 'start').length, starts);
  }, 10_000);
}

test('helpers start from their definition: its kind, model and description reach hub and peers', async () => {
  const f = await fixture();
  await up(f);
  const calls = (await f.read()).calls;
  const start = calls.find((a: string[]) => a[1] === 'start')!;
  assert.deepEqual(start.slice(3, 5), ['--kind', 'codex']);
  const prompt = calls.find((a: string[]) => a[1] === 'prompt')![3]!;
  assert.match(
    prompt,
    /Your instructions:\nReview when asked\.[\s\S]*Your initial task:[\s\S]*Review the code/,
  );
  const hub = Bun.spawnSync([...(await hubCommand()), 'status', '--json'], { env: f.env });
  const members = JSON.parse(hub.stdout.toString()).members as { handle: string }[];
  assert.ok(members.some((m) => m.handle === 'reviewer'));
  assert.match(
    Bun.spawnSync([...(await hubCommand()), 'status'], { env: f.env }).stdout.toString(),
    /@reviewer — reviews the code/,
  );
});

test('editing a definition replaces the helper on the next up', async () => {
  const f = await fixture();
  await up(f);
  await up(f);
  assert.equal((await f.read()).calls.filter((a: string[]) => a[1] === 'start').length, 1);
  await f.define(
    'reviewer',
    '---\ndescription: reviews the code\nkind: codex\n---\nReview security.\n',
  );
  await assert.rejects(up(f), /occupied|draining/);
  await f.tick();
  await up(f);
  const prompts = (await f.read()).calls.filter((a: string[]) => a[1] === 'prompt');
  assert.equal(prompts.length, 2);
  assert.match(prompts.at(-1)![3]!, /Review security\./);
}, 10_000);

test('inline kind and missing definitions are refused before any layout change', async () => {
  for (const [entry, error] of [
    ['    kind: codex\n    tab: helpers', /Invalid team YAML/],
    [
      '    use: nobody\n    tab: helpers',
      /No agent definition "nobody" .* Definitions there: coordinator, reviewer\./,
    ],
  ] as const) {
    const f = await fixture();
    await Bun.write(
      f.file,
      (await Bun.file(f.file).text()).replace('    use: reviewer\n    tab: helpers', entry),
    );
    await assert.rejects(up(f), error);
    assert.equal(
      (await f.read()).calls.some((a: string[]) => ['create', 'start', 'close'].includes(a[1]!)),
      false,
    );
  }
});

test('a team is found by name in the herdr-team folder, and use: paths are relative to it', async () => {
  const f = await fixture();
  const teams = path.join(f.root, 'team', 'teams');
  fs.mkdirSync(path.join(teams, 'local'), { recursive: true });
  fs.writeFileSync(
    path.join(teams, 'local', 'helper.md'),
    '---\ndescription: helps locally\nkind: codex\n---\nHelp.\n',
  );
  const yaml = (await Bun.file(f.file).text()).replace(
    '    use: reviewer',
    '    use: ./local/helper.md',
  );
  fs.writeFileSync(path.join(teams, 'test.yaml'), yaml);
  await up({ ...f, file: 'test' });
  assert.match(status({ env: f.env }), /reviewer=@reviewer \(ready; room: \w+\)/);
  const prompt = (await f.read()).calls.find((a: string[]) => a[1] === 'prompt')![3]!;
  assert.match(prompt, /Your instructions:\nHelp\./);
  assert.match(await down({ ...f, file: 'test' }), /is down/);
});

test('up without a team reads herdr-team.yaml in the current folder only', async () => {
  const f = await fixture();
  const project = path.join(f.root, 'project');
  fs.mkdirSync(path.join(project, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'team', 'teams'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'team', 'teams', 'review.yaml'), 'name: review\n');
  await assert.rejects(
    up({ ...f, file: undefined, cwd: project }),
    new RegExp(`No herdr-team\\.yaml in ${project}\\. Teams in .*teams: review; name one\\.`),
  );
  fs.copyFileSync(f.file, path.join(project, 'herdr-team.yaml'));
  await assert.rejects(
    up({ ...f, file: undefined, cwd: path.join(project, 'nested') }),
    /No herdr-team/,
  );
  await up({ ...f, file: undefined, cwd: project });
  assert.match(status({ env: f.env }), /Deployment test: reviewer=@reviewer \(ready; room: \w+\)/);
});

test('down without a team takes down the only deployment, and names them when there are several', async () => {
  const f = await fixture();
  assert.equal(await down({ ...f, file: undefined }), 'No deployments in this workspace.');
  await up(f);
  const other = path.join(f.root, 'other.yaml');
  fs.writeFileSync(other, 'name: other\ntabs: {}\nagents: {}\n');
  await up({ ...f, file: other });
  await assert.rejects(
    down({ ...f, file: undefined }),
    /This workspace has 2 deployments: (other, test|test, other)\. Name the one to take down\./,
  );
  await down({ ...f, file: other });
  assert.match(await down({ ...f, file: undefined }), /Deployment test is down\./);
});

test('up --dry-run says what it would do and why, and changes nothing', async () => {
  const f = await fixture();
  const fresh = await up({ ...f, dryRun: true });
  assert.equal(
    fresh.output,
    'Dry run of test; nothing was changed.\nLay out tab helpers in a new tab.\nStart @reviewer (reviewer) in tab helpers.',
  );
  assert.equal(status({ env: f.env }), 'No deployments in this workspace.');
  await up(f);
  const before = (await f.read()).calls.length;
  assert.match((await up({ ...f, dryRun: true })).output, /Deployment test is unchanged\./);
  await f.write('Review security');
  await f.define(
    'reviewer',
    '---\ndescription: reviews security\nkind: codex\nmodel: example-v1\n---\nReview.\n',
  );
  const changed = await up({ ...f, dryRun: true });
  assert.match(
    changed.output,
    /Replace @reviewer \(reviewer\): its definition changed, its prompt changed\./,
  );
  assert.deepEqual(changed.changes, [
    {
      action: 'replace',
      agent: 'reviewer',
      handle: 'reviewer',
      reasons: ['its definition changed', 'its prompt changed'],
    },
  ]);
  const after = (await f.read()).calls.slice(before);
  assert.equal(
    after.some((a: string[]) => ['create', 'start', 'close', 'move', 'prompt'].includes(a[1]!)),
    false,
  );
  assert.match(status({ env: f.env }), /reviewer=@reviewer \(ready; room: \w+\)/);
});

test('up --dry-run plans from a script in a shell pane, where up itself is refused', async () => {
  const f = await fixture();
  const { panes } = await f.read();
  await f.change({ panes: panes.map((p) => ({ ...p, agent: null })) });
  const planned = await up({ ...f, interactive: false, dryRun: true });
  assert.match(planned.output, /Start the codex lead in this pane\.$/);
  await assert.rejects(up({ ...f, interactive: false }), /No agent is recognized in this pane/);
});

test("status shows each helper's room membership, and JSON for status, down and up", async () => {
  const f = await fixture();
  await up(f);
  const listed = JSON.parse(status({ env: f.env, json: true }));
  assert.equal(listed.deployments[0].name, 'test');
  assert.deepEqual(
    { ...listed.deployments[0].agents[0], pane: 'p' },
    { key: 'reviewer', handle: 'reviewer', phase: 'ready', pane: 'p', room: 'active' },
  );
  fs.rmSync(path.join(f.root, 'state', 'hub'), { recursive: true });
  await f.tick();
  assert.match(status({ env: f.env }), /reviewer=@reviewer \(ready; room: not a member\)/);
  const cli = Bun.spawn([...(await composeCommand()), 'up', f.file, '--dry-run', '--json'], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const planned = JSON.parse(await new Response(cli.stdout).text());
  assert.equal(await cli.exited, 0);
  assert.equal(planned.deployment, 'test');
  assert.equal(planned.dryRun, true);
  assert.deepEqual(planned.changes[0], {
    action: 'replace',
    agent: 'reviewer',
    handle: 'reviewer',
    reasons: ['its conversation is gone'],
  });
  assert.deepEqual(JSON.parse(await down({ ...f, json: true })), {
    deployment: 'test',
    removed: ['reviewer'],
  });
  assert.deepEqual(JSON.parse(await down({ ...f, file: undefined, json: true })), {
    deployment: null,
    removed: [],
  });
});

test("a running lead is told to join as the team's lead definition, else with a made-up role", async () => {
  const f = await fixture();
  const coordinator = path.join(f.root, 'team', 'agents', 'coordinator.md');
  assert.match(
    (await up(f)).output,
    new RegExp(`First join as @lead: .* join '?${coordinator}'? --handle lead\\. Confirm`),
  );
  await down(f);
  await f.tick();
  await Bun.write(
    f.file,
    (await Bun.file(f.file).text()).replace('lead:\n  use: coordinator\n', ''),
  );
  assert.match(
    (await up(f)).output,
    /First join as @lead: .* join --handle lead --description 'lead, coordinates test'\. Confirm/,
  );
});

test('@lead held from another pane is taken while that pane is open, and retried once it closes', async () => {
  const f = await fixture();
  const { panes } = await f.read();
  const other = { ...panes[0]!, pane_id: 'other', terminal_id: 'other-terminal' };
  await f.change({ panes: [...panes, other] });
  const join = Bun.spawn(
    [...(await hubCommand()), 'join', '--handle', 'lead', '--description', 'lead, elsewhere'],
    { env: { ...f.env, HERDR_PANE_ID: 'other' }, stdout: 'pipe', stderr: 'pipe' },
  );
  assert.equal(await join.exited, 0, await new Response(join.stderr).text());
  await assert.rejects(up(f), /already in use in another pane/);
  await f.change({ panes });
  const cli = Bun.spawn([...(await composeCommand()), 'up', f.file], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(await cli.exited, 75);
  assert.match(await new Response(cli.stderr).text(), /pane has closed/);
}, 10_000);

test('teams lists the team files, each read as up would, without Herdr', async () => {
  const f = await fixture();
  assert.match(await teams({ env: f.env }), /^No teams in .*teams\./);
  const dir = path.join(f.root, 'team', 'teams');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'review.yaml'),
    (await Bun.file(f.file).text()).replace('name: test', 'name: review'),
  );
  fs.writeFileSync(path.join(dir, 'broken.yml'), 'name: broken\nagents:\n  a:\n    use: nobody\n');
  const before = (await f.read()).calls.length;
  const listed = await teams({ env: f.env });
  assert.match(listed, / {2}review: deployment review, agents reviewer/);
  assert.match(listed, / {2}broken: /);
  const json = JSON.parse(await teams({ env: f.env, json: true }));
  assert.deepEqual(
    json.teams.map((t: { name: string; problem?: string }) => [t.name, !!t.problem]),
    [
      ['broken', true],
      ['review', false],
    ],
  );
  assert.equal((await f.read()).calls.length, before);
});

// The compose executable, as users run it.
async function composeCommand(): Promise<string[]> {
  return process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-compose')]
    : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/compose/cli'))];
}

// The hub executable compose itself runs.
async function hubCommand(): Promise<string[]> {
  return process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-hub')]
    : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/hub/cli'))];
}
