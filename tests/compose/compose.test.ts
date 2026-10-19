import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { down, status, up } from '@herdr/compose';
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
  assert.ok(fs.existsSync(path.join(f.root, 'compose', 'compose.db')));
  assert.ok(fs.existsSync(path.join(f.root, 'hub', 'chat.db')));
});

test('changed purpose waits for hub to retire the old membership before replacing', async () => {
  const f = await fixture();
  await up(f);
  await f.write('Review security');
  await assert.rejects(up(f), /occupied|draining/);
  assert.equal((await f.read()).panes.filter((p) => p.agent === 'codex').length, 1);
  await f.tick();
  await up(f);
  assert.equal((await f.read()).calls.filter((a: string[]) => a[1] === 'start').length, 2);
});

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
  fs.rmSync(path.join(f.root, 'hub'), { recursive: true });
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
  assert.match(status({ env: f.env }), /reviewer=@reviewer \(ready\)/);
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
    assert.match(status({ env: f.env }), /reviewer=@auditor \(ready\)/);
    if (swap) {
      assert.match(status({ env: f.env }), /auditor=@reviewer \(ready\)/);
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
});

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
  assert.match(status({ env: f.env }), /reviewer=@reviewer \(ready\)/);
  const prompt = (await f.read()).calls.find((a: string[]) => a[1] === 'prompt')![3]!;
  assert.match(prompt, /Your instructions:\nHelp\./);
  assert.match(await down({ ...f, file: 'test' }), /is down/);
});

// The hub executable compose itself runs.
async function hubCommand(): Promise<string[]> {
  return process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-agent-hub')]
    : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/hub/cli'))];
}
