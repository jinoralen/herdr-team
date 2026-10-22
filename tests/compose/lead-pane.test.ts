import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { down, status, up } from '@herdr/compose';
import { fixture } from './fixture.ts';

test('shell up owns a separate lead pane, preserves the caller and reuses the lead', async () => {
  const f = await fixture();
  const { panes } = await f.read();
  await f.change({ panes: panes.map((p) => ({ ...p, agent: null })) });
  await up(f);
  const owned = JSON.parse(status({ env: f.env, json: true })).deployments[0].agents;
  const lead = owned.find((a: { handle: string }) => a.handle === 'lead');
  assert.ok(lead);
  assert.notEqual(lead.pane, 'lead');
  assert.equal((await f.read()).panes.find((p) => p.pane_id === 'lead')!.agent, null);
  assert.match(
    (await f.read()).calls.find((a) => a[1] === 'prompt' && a[2] === lead.pane)![3]!,
    /Hub starts you as @lead/,
  );
  await up(f);
  assert.equal((await f.read()).calls.filter((a) => a[1] === 'start').length, 2);
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
    (await f.read()).panes.map((p) => p.pane_id),
    ['lead'],
  );
});

test('up --json creates a lead from a script in a shell pane and returns JSON', async () => {
  const f = await fixture();
  const { panes } = await f.read();
  await f.change({ panes: panes.map((p) => ({ ...p, agent: null })) });
  assert.match((await up({ ...f, dryRun: true })).output, /Start @lead/);
  const cli = Bun.spawn([...(await composeCommand()), 'up', f.file, '--json'], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(cli.stdout).text();
  assert.equal(await cli.exited, 0, await new Response(cli.stderr).text());
  assert.equal(JSON.parse(output).deployment, 'test');
  assert.equal((await f.read()).panes.length, 3);
  assert.equal((await f.read()).panes[0]!.agent, null);
});

test('a lead definition is required before creating any panes', async () => {
  const f = await fixture();
  await Bun.write(
    f.file,
    (await Bun.file(f.file).text()).replace('lead:\n  use: coordinator\n', ''),
  );
  await assert.rejects(up(f), /Invalid team YAML/);
  assert.equal(
    (await f.read()).calls.some((a) => ['create', 'start', 'close'].includes(a[1]!)),
    false,
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
  await assert.rejects(up(f), /occupied/);
  await f.change({ panes });
  const cli = Bun.spawn([...(await composeCommand()), 'up', f.file], {
    env: f.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(await cli.exited, 75);
  assert.match(await new Response(cli.stderr).text(), /pane has closed/);
}, 10_000);

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
