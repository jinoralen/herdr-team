// Compose against an in-memory Herdr and hub (world.ts): each test runs up and down in-process and
// compares the commands they sent. What only the real hub shows is in e2e.test.ts.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { down, status, teams, up } from '@herdr/compose';
import { sim } from './world.ts';

// A failure that waiting fixes: the command line exits with 75 (EX_TEMPFAIL).
const retryLater =
  (message: RegExp) =>
  (error: Error & { exitCode?: number }): boolean =>
    error.exitCode === 75 && message.test(error.message);

test('up lays out every pane before starting, keeps healthy helpers and moves them for a new layout', async () => {
  const s = sim();
  await up(s);
  assert.deepEqual(s.world.changes(), [
    'tab create hub-<id>',
    'tab rename tab1 test:helpers',
    'tab create hub-<id>',
    'pane move pane2 --tab tab1 --target-pane pane1 --split right',
    'pane close pane1',
    'invite reviewer.md --handle reviewer --pane pane2',
  ]);
  assert.match(s.world.prompts()[0]!.prompt, /Review the code/);
  const first = s.world.changes().length;
  await up(s);
  assert.deepEqual(s.world.changes().slice(first), ['tab rename tab1 test:helpers']);
  const second = s.world.changes().length;
  s.write('Review the code', 'rows');
  await up(s);
  assert.deepEqual(s.world.changes().slice(second), [
    'tab create hub-<id>',
    'tab rename tab5 test:helpers',
    'pane move pane2 --tab tab5 --target-pane pane5 --split down',
    'pane close pane5',
  ]);
  assert.ok(fs.existsSync(path.join(s.root, 'state', 'compose', 'compose.db')));
});

test('changed purpose waits for hub to retire the old membership before replacing', async () => {
  const s = sim();
  await up(s);
  s.write('Review security');
  await assert.rejects(up(s), retryLater(/occupied|draining/));
  assert.equal(s.world.panes.filter((p) => p.agent === 'codex').length, 1);
  s.world.tick();
  await up(s);
  assert.equal(s.world.prompts().length, 2);
  assert.match(s.world.prompts()[1]!.prompt, /Review security/);
});

test('down retains unrelated panes and ownership survives hub state removal', async () => {
  const s = sim();
  await up(s);
  const tab = s.world.panes.find((p) => p.pane_id !== 'lead')!.tab_id;
  s.world.panes.push({
    pane_id: 'foreign',
    terminal_id: 'foreign-t',
    workspace_id: 'w1',
    tab_id: tab,
    agent: null,
    agent_status: 'idle',
  });
  s.world.forgetMembers();
  await down(s);
  assert.deepEqual(s.world.panes.map((p) => p.pane_id).sort(), ['foreign', 'lead']);
  assert.match(await down(s), /already down/);
});

test('invalid manifests make no layout changes', async () => {
  const s = sim();
  fs.writeFileSync(s.file, 'name: test\nagents: broken');
  await assert.rejects(up(s), /Invalid team YAML/);
  assert.deepEqual(s.world.changes(), []);
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
    const s = sim();
    fs.writeFileSync(
      s.file,
      fs.readFileSync(s.file, 'utf8').replace('    tab: helpers', replacement),
    );
    await assert.rejects(up(s), error);
    assert.deepEqual(s.world.changes(), []);
  });
}

for (const retry of ['up', 'down'] as const) {
  test(`a rejected tab creation does not block the next ${retry}`, async () => {
    const s = sim();
    s.world.failNext('create-refused');
    await assert.rejects(up(s), /refused/);
    if (retry === 'up') {
      await up(s);
      assert.equal(s.world.panes.length, 2);
    } else {
      await down(s);
      assert.deepEqual(
        s.world.panes.map((p) => p.pane_id),
        ['lead'],
      );
      assert.match(await down(s), /already down/);
    }
  });
}

test('lost allocation responses are recovered before retrying up', async () => {
  const s = sim();
  s.world.failNext('create-lost');
  await assert.rejects(up(s), /timeout/);
  await up(s);
  assert.equal(s.world.panes.length, 2);
  assert.equal(s.world.prompts().length, 1);
});

test('uncertain startup prompts are never repeated into the same conversation', async () => {
  const s = sim();
  s.world.failNext('prompt');
  await assert.rejects(up(s), /Inspect the pane/);
  await assert.rejects(up(s), retryLater(/occupied|draining/));
  s.world.tick();
  await up(s);
  const [first, second] = s.world.prompts();
  assert.equal(s.world.prompts().length, 2);
  assert.notEqual(first!.pane, second!.pane);
});

test('new helpers start together, and one that fails leaves the others ready', async () => {
  const s = sim();
  fs.appendFileSync(s.file, '  auditor:\n    use: reviewer\n    tab: helpers\n');
  s.world.startDelay = 20;
  s.world.failNext('prompt');
  await assert.rejects(up(s), /Inspect the pane/);
  assert.equal(s.world.maxStarting, 2);
  // Both panes were laid out before either agent started.
  assert.deepEqual(
    s.world.changes().filter((c) => c.startsWith('invite')),
    s.world.changes().slice(-2),
  );
  const phases = JSON.parse(status({ ...s, json: true }))
    .deployments[0].agents.map((a: { phase: string }) => a.phase)
    .sort();
  assert.deepEqual(phases, ['ready', 'started']);
});

test('shared context is resolved before changes and changing it replaces the helper', async () => {
  const s = sim();
  fs.appendFileSync(s.file, 'shared:\n  files: [context.md]\n');
  await assert.rejects(up(s), /No such file|ENOENT/);
  assert.deepEqual(s.world.changes(), []);
  fs.writeFileSync(path.join(s.root, 'context.md'), 'First brief');
  await up(s);
  fs.writeFileSync(path.join(s.root, 'context.md'), 'Second brief');
  await assert.rejects(up(s), retryLater(/occupied|draining/));
  s.world.tick();
  await up(s);
  assert.match(s.world.prompts().at(-1)!.prompt, /Second brief/);
});

test('colliding deployments do not close or start any additional helpers', async () => {
  const s = sim();
  await up(s);
  const before = s.world.changes().length;
  fs.writeFileSync(s.file, fs.readFileSync(s.file, 'utf8').replace('name: test', 'name: other'));
  await assert.rejects(up(s), /occupied/);
  assert.deepEqual(s.world.changes().slice(before), []);
});

test('status reports ownership without Herdr access and down needs no context files', async () => {
  const s = sim();
  await up(s);
  const before = s.world.calls.length;
  assert.match(status(s), /reviewer=@reviewer \(ready; room: active\)/);
  assert.equal(s.world.calls.length, before);
  fs.writeFileSync(s.file, 'name: test\nshared:\n  files: [missing.md]\n');
  await down(s);
  assert.match(status(s), /No deployments/);
});

test('shell bootstrap delegates the lead to hub and keeps the lead outside ownership', async () => {
  const s = sim();
  s.world.panes[0]!.agent = null;
  const result = await up({ ...s, interactive: true });
  assert.equal(result.launch?.kind, 'codex');
  assert.match(result.launch!.prompt, /Hub starts you as @lead/);
  await down(s);
  assert.deepEqual(
    s.world.panes.map((p) => p.pane_id),
    ['lead'],
  );
});

for (const swap of [false, true]) {
  test(`${swap ? 'swapping' : 'reassigning'} owned handles retires helpers before waiting for reuse`, async () => {
    const s = sim();
    const original = fs.readFileSync(s.file, 'utf8');
    const auditor = '  auditor:\n    use: reviewer\n    tab: helpers\n';
    fs.writeFileSync(s.file, original + auditor);
    await up(s);
    const changed = original.replace(
      '    use: reviewer\n    tab: helpers',
      '    use: reviewer\n    handle: auditor\n    tab: helpers',
    );
    fs.writeFileSync(
      s.file,
      changed +
        (swap ? auditor.replace('    tab: helpers', '    handle: reviewer\n    tab: helpers') : ''),
    );
    await assert.rejects(up(s), retryLater(/occupied|draining/));
    assert.deepEqual(
      s.world.panes.filter((p) => p.agent).map((p) => p.pane_id),
      ['lead'],
    );
    s.world.tick();
    await up(s);
    assert.match(status(s), /reviewer=@auditor \(ready; room: active\)/);
    if (swap) {
      assert.match(status(s), /auditor=@reviewer \(ready; room: active\)/);
    }
    const starts = s.world.prompts().length;
    await up(s);
    assert.equal(s.world.prompts().length, starts);
  });
}

test('editing a definition replaces the helper on the next up', async () => {
  const s = sim();
  await up(s);
  await up(s);
  assert.equal(s.world.prompts().length, 1);
  s.define('reviewer', '---\ndescription: reviews the code\nkind: codex\n---\nReview security.\n');
  await assert.rejects(up(s), retryLater(/occupied|draining/));
  s.world.tick();
  await up(s);
  assert.equal(s.world.prompts().length, 2);
});

test('inline kind and missing definitions are refused before any layout change', async () => {
  for (const [entry, error] of [
    ['    kind: codex\n    tab: helpers', /Invalid team YAML/],
    [
      '    use: nobody\n    tab: helpers',
      /No agent definition "nobody" .* Definitions there: coordinator, reviewer\./,
    ],
  ] as const) {
    const s = sim();
    fs.writeFileSync(
      s.file,
      fs.readFileSync(s.file, 'utf8').replace('    use: reviewer\n    tab: helpers', entry),
    );
    await assert.rejects(up(s), error);
    assert.deepEqual(s.world.changes(), []);
  }
});

test('a team is found by name in the herdr-team folder, and use: paths are relative to it', async () => {
  const s = sim();
  const dir = path.join(s.root, 'team', 'teams');
  fs.mkdirSync(path.join(dir, 'local'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'local', 'helper.md'),
    '---\ndescription: helps locally\nkind: codex\n---\nHelp.\n',
  );
  fs.writeFileSync(
    path.join(dir, 'test.yaml'),
    fs.readFileSync(s.file, 'utf8').replace('    use: reviewer', '    use: ./local/helper.md'),
  );
  await up({ ...s, file: 'test' });
  assert.match(status(s), /reviewer=@reviewer \(ready; room: active\)/);
  assert.equal(
    s.world.calls.find((c) => c[0] === 'invite')![1],
    path.join(dir, 'local', 'helper.md'),
  );
  assert.match(await down({ ...s, file: 'test' }), /is down/);
});

test('up without a team reads herdr-team.yaml in the current folder only', async () => {
  const s = sim();
  const project = path.join(s.root, 'project');
  fs.mkdirSync(path.join(project, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(s.root, 'team', 'teams'), { recursive: true });
  fs.writeFileSync(path.join(s.root, 'team', 'teams', 'review.yaml'), 'name: review\n');
  await assert.rejects(
    up({ ...s, file: undefined, cwd: project }),
    new RegExp(`No herdr-team\\.yaml in ${project}\\. Teams in .*teams: review; name one\\.`),
  );
  fs.copyFileSync(s.file, path.join(project, 'herdr-team.yaml'));
  await assert.rejects(
    up({ ...s, file: undefined, cwd: path.join(project, 'nested') }),
    /No herdr-team/,
  );
  await up({ ...s, file: undefined, cwd: project });
  assert.match(status(s), /Deployment test: reviewer=@reviewer \(ready; room: active\)/);
});

test('down without a team takes down the only deployment, and names them when there are several', async () => {
  const s = sim();
  assert.equal(await down({ ...s, file: undefined }), 'No deployments in this workspace.');
  await up(s);
  const other = path.join(s.root, 'other.yaml');
  fs.writeFileSync(other, 'name: other\ntabs: {}\nagents: {}\n');
  await up({ ...s, file: other });
  await assert.rejects(
    down({ ...s, file: undefined }),
    /This workspace has 2 deployments: (other, test|test, other)\. Name the one to take down\./,
  );
  await down({ ...s, file: other });
  assert.match(await down({ ...s, file: undefined }), /Deployment test is down\./);
});

test('up --dry-run says what it would do and why, and changes nothing', async () => {
  const s = sim();
  const fresh = await up({ ...s, dryRun: true });
  assert.equal(
    fresh.output,
    'Dry run of test; nothing was changed.\nLay out tab helpers in a new tab.\nStart @reviewer (reviewer) in tab helpers.',
  );
  assert.deepEqual(s.world.changes(), []);
  assert.equal(status(s), 'No deployments in this workspace.');
  await up(s);
  const before = s.world.changes().length;
  assert.match((await up({ ...s, dryRun: true })).output, /Deployment test is unchanged\./);
  s.write('Review security');
  s.define(
    'reviewer',
    '---\ndescription: reviews security\nkind: codex\nmodel: example-v1\n---\nReview.\n',
  );
  const changed = await up({ ...s, dryRun: true });
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
  assert.deepEqual(s.world.changes().slice(before), []);
  assert.match(status(s), /reviewer=@reviewer \(ready; room: active\)/);
});

test('up --dry-run plans from a script in a shell pane, where up itself is refused', async () => {
  const s = sim();
  s.world.panes[0]!.agent = null;
  const planned = await up({ ...s, interactive: false, dryRun: true });
  assert.match(planned.output, /Start the codex lead in this pane\.$/);
  await assert.rejects(up({ ...s, interactive: false }), /No agent is recognized in this pane/);
});

test("status shows each helper's room membership, and JSON for status and down", async () => {
  const s = sim();
  await up(s);
  const listed = JSON.parse(status({ ...s, json: true }));
  assert.equal(listed.deployments[0].name, 'test');
  assert.deepEqual(listed.deployments[0].agents[0], {
    key: 'reviewer',
    handle: 'reviewer',
    phase: 'ready',
    pane: 'pane2',
    room: 'active',
  });
  s.world.forgetMembers();
  assert.match(status(s), /reviewer=@reviewer \(ready; room: not a member\)/);
  assert.deepEqual((await up({ ...s, dryRun: true })).changes?.[0], {
    action: 'replace',
    agent: 'reviewer',
    handle: 'reviewer',
    reasons: ['its conversation is gone'],
  });
  assert.deepEqual(JSON.parse(await down({ ...s, json: true })), {
    deployment: 'test',
    removed: ['reviewer'],
  });
  assert.deepEqual(JSON.parse(await down({ ...s, file: undefined, json: true })), {
    deployment: null,
    removed: [],
  });
});

test("a running lead is told to join as the team's lead definition, else with a made-up role", async () => {
  const s = sim();
  const coordinator = path.join(s.root, 'team', 'agents', 'coordinator.md');
  assert.match(
    (await up(s)).output,
    new RegExp(`First join as @lead: .* join '?${coordinator}'? --handle lead\\. Confirm`),
  );
  await down(s);
  s.world.tick();
  fs.writeFileSync(
    s.file,
    fs.readFileSync(s.file, 'utf8').replace('lead:\n  use: coordinator\n', ''),
  );
  assert.match(
    (await up(s)).output,
    /First join as @lead: .* join --handle lead --description 'lead, coordinates test'\. Confirm/,
  );
});

test('@lead held from another pane is taken while that pane is open, and retried once it closes', async () => {
  const s = sim();
  s.world.panes.push({ ...s.world.panes[0]!, pane_id: 'other', terminal_id: 'other-terminal' });
  s.world.join('lead', 'other');
  await assert.rejects(up(s), /already in use in another pane/);
  s.world.panes = s.world.panes.filter((p) => p.pane_id !== 'other');
  await assert.rejects(up(s), retryLater(/pane has closed/));
  assert.deepEqual(s.world.changes(), []);
});

test('teams lists the team files, each read as up would, without Herdr', async () => {
  const s = sim();
  assert.match(await teams(s), /^No teams in .*teams\./);
  const dir = path.join(s.root, 'team', 'teams');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'review.yaml'),
    fs.readFileSync(s.file, 'utf8').replace('name: test', 'name: review'),
  );
  fs.writeFileSync(path.join(dir, 'broken.yml'), 'name: broken\nagents:\n  a:\n    use: nobody\n');
  const listed = await teams(s);
  assert.match(listed, / {2}review: deployment review, agents reviewer/);
  assert.match(listed, / {2}broken: /);
  const json = JSON.parse(await teams({ ...s, json: true }));
  assert.deepEqual(
    json.teams.map((t: { name: string; problem?: string }) => [t.name, !!t.problem]),
    [
      ['broken', true],
      ['review', false],
    ],
  );
  assert.deepEqual(s.world.calls, []);
});
