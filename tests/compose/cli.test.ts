import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { up } from '@herdr/compose';
import { createProgram } from '@herdr/compose/cli';
import { sim } from './world.ts';

test('compose CLI starts, reports and dismantles a deployment through fake clients', async () => {
  const f = sim();
  async function run(args: string[]) {
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
    }).run(args);
    assert.equal(code, 0, stderr);
    return stdout;
  }
  assert.match(await run(['up', f.file]), /Created @reviewer/);
  assert.match(await run(['status']), /reviewer=@reviewer/);
  assert.match(await run(['down', f.file]), /is down/);
  assert.match(await run(['status']), /No deployments/);
});

test('__complete lists the team names up and down accept, for the zsh completion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-teams-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'teams'));
  fs.writeFileSync(path.join(dir, 'teams', 'demo.yaml'), 'name: demo\n');
  let stdout = '';
  const code = await createProgram({
    env: { HERDR_TEAM_DIR: dir },
    stdout: (text) => {
      stdout += text;
    },
  }).run(['__complete', 'teams']);
  assert.equal(code, 0);
  assert.equal(stdout, `demo\t${path.join(dir, 'teams', 'demo.yaml')}\n`);
});

test('up --dry-run --json replaces a helper whose hub state is gone', async () => {
  const f = sim();
  await up(f);
  f.world.forgetMembers();
  let stdout = '';
  const code = await createProgram({
    ...f,
    stdout: (text) => {
      stdout += text;
    },
  }).run(['up', f.file, '--dry-run', '--json']);
  assert.equal(code, 0);
  const planned = JSON.parse(stdout);
  assert.equal(planned.dryRun, true);
  assert.deepEqual(planned.changes[0], {
    action: 'replace',
    agent: 'reviewer',
    handle: 'reviewer',
    reasons: ['its conversation is gone'],
  });
});
