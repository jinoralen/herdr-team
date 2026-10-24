import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { down, status, up } from '@herdr/compose';
import { createProgram } from '@herdr/compose/cli';
import { sim } from './world.ts';

test('shell up owns a separate lead pane, preserves the caller and reuses the lead', async () => {
  const f = sim();
  f.world.panes[0]!.agent = null;
  await up(f);
  const owned = JSON.parse(await status({ ...f, json: true })).deployments[0].agents;
  const lead = owned.find((a: { handle: string }) => a.handle === 'lead');
  assert.ok(lead);
  assert.notEqual(lead.pane, 'lead');
  assert.equal(f.world.panes.find((p) => p.pane_id === 'lead')!.agent, null);
  const starts = f.world.prompts();
  assert.equal(starts.length, 2);
  assert.deepEqual(starts.map(({ handle }) => handle).sort(), ['lead', 'reviewer']);
  const leadStart = starts.find(({ handle }) => handle === 'lead')!;
  assert.equal(leadStart.pane, lead.pane);
  assert.match(leadStart.prompt, /Coordinate/);
  assert.equal(
    f.world.calls.find((a) => a[0] === 'invite' && a.includes(lead.pane))![1],
    path.join(f.root, 'team', 'agents', 'coordinator.md'),
  );
  await up(f);
  assert.deepEqual(f.world.prompts(), starts);
  await assert.rejects(
    up({ ...f, env: { ...f.env, HERDR_PANE_ID: lead.pane } }),
    /separate control pane/,
  );
  await assert.rejects(
    down({ ...f, env: { ...f.env, HERDR_PANE_ID: lead.pane } }),
    /separate control pane/,
  );
  await down(f);
  assert.deepEqual(
    f.world.panes.map((p) => p.pane_id),
    ['lead'],
  );
});

test('up --json creates a lead from a script in a shell pane and returns JSON', async () => {
  const f = sim();
  f.world.panes[0]!.agent = null;
  assert.match((await up({ ...f, dryRun: true })).output, /Start @lead/);
  let stdout = '';
  let stderr = '';
  const code = await createProgram({
    ...f,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  }).run(['up', f.file, '--json']);
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).deployment, 'test');
  assert.equal(f.world.panes.length, 3);
  assert.equal(f.world.panes[0]!.agent, null);
});

test('a lead definition is required before creating any panes', async () => {
  const f = sim();
  await Bun.write(
    f.file,
    (await Bun.file(f.file).text()).replace('lead:\n  use: coordinator\n', ''),
  );
  await assert.rejects(up(f), /Invalid team YAML/);
  assert.deepEqual(f.world.changes(), []);
});

test('@lead held from another pane is taken while that pane is open, and retried once it closes', async () => {
  const f = sim();
  f.world.panes.push({
    ...f.world.panes[0]!,
    pane_id: 'other',
    terminal_id: 'other-terminal',
  });
  f.world.join('lead', 'other');
  await assert.rejects(up(f), /occupied/);
  assert.deepEqual(f.world.changes(), []);
  f.world.panes = f.world.panes.filter((p) => p.pane_id !== 'other');
  await assert.rejects(
    up(f),
    (error: Error & { exitCode?: number }) =>
      error.exitCode === 75 && /pane has closed/.test(error.message),
  );
  assert.deepEqual(f.world.changes(), []);
  f.world.tick();
  await up(f);
  assert.equal(f.world.prompts().filter(({ handle }) => handle === 'lead').length, 1);
});
