import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixture.ts';

test('compose CLI starts, reports and dismantles a deployment through hub commands', async () => {
  const f = await fixture();
  const command = process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-compose')]
    : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/compose/cli'))];
  async function run(args: string[]) {
    const proc = Bun.spawn([...command, ...args], { env: f.env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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
  const command = process.env.HERDR_TEST_BIN_DIR
    ? [path.resolve(process.env.HERDR_TEST_BIN_DIR, 'herdr-compose')]
    : [process.execPath, fileURLToPath(import.meta.resolve('@herdr/compose/cli'))];
  const proc = Bun.spawnSync([...command, '__complete', 'teams'], {
    env: { PATH: process.env.PATH ?? '', HERDR_TEAM_DIR: dir },
  });
  assert.equal(proc.stdout.toString(), `demo\t${path.join(dir, 'teams', 'demo.yaml')}\n`);
});
