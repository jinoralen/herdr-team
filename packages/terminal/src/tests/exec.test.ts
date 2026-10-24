// The real Exec against small executables: what the in-process ones in other tests stand in for.

import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnExec } from '../exec.ts';

function script(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cmd');
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

test('argv entries reach the process untouched, with the given environment', async () => {
  const bin = script(
    `console.log(JSON.stringify([process.argv.slice(2), process.env.MARK])); console.error('e'); process.exit(3);`,
  );
  const text = 'line1\n$(touch /tmp/pwned) `id` ; \'q\' "dq" 🚀';
  const exited = await spawnExec([bin, 'a', text], { env: { MARK: 'm' } });
  assert.deepEqual(JSON.parse(exited.stdout), [['a', text], 'm']);
  assert.deepEqual(
    { ...exited, stdout: '' },
    {
      exitCode: 3,
      stdout: '',
      stderr: 'e\n',
      timedOut: false,
    },
  );
});

test('a process that outlives its timeout is killed and reported as timed out', async () => {
  const exited = await spawnExec([script('setTimeout(() => {}, 10000);')], {
    env: {},
    timeout: 200,
  });
  assert.equal(exited.timedOut, true);
});

test('a missing executable rejects with ENOENT', async () => {
  await assert.rejects(spawnExec(['/nonexistent/cmd'], { env: {} }), { code: 'ENOENT' });
});
