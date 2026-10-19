import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { message } from '#agent';
import { filesDir, MAX_MESSAGE_CHARS } from '#store';
import { installed } from '#testing';

// A folder of the agent's own files, outside the state directory.
function workdir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-attach-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const attachedPaths = (text: string): string[] =>
  text
    .split('\nAttached:\n')[1]!
    .split('\n')
    .map((line) => line.trim());

test('attached files are copied when posted and listed after the text', async () => {
  const { env, joinAs, store, root } = await installed();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  const cwd = workdir({ 'plan.md': 'the plan', 'a/log.txt': 'first log', 'b/log.txt': 'second' });
  const out = message({
    text: 'Plan and both logs.\n',
    attach: ['plan.md', 'a/log.txt', path.join(cwd, 'b/log.txt'), 'plan.md'],
    cwd,
    env: env('p1'),
  });
  assert.match(out, /^Queued as @codex for @claude\./);
  const [post] = store()
    .queued('claude')
    .filter((q) => q.kind === 'message');
  assert.match(post!.text, /^Plan and both logs\.\n\nAttached:\n {2}\//);
  const paths = attachedPaths(post!.text);
  assert.deepEqual(
    paths.map((p) => path.basename(p)),
    ['plan.md', 'log.txt', 'log-2.txt'],
    'one copy per file, names kept, repeats listed once',
  );
  for (const p of paths) {
    assert.ok(p.startsWith(`${root}/files/codex-`), p);
  }
  assert.deepEqual(
    paths.map((p) => fs.readFileSync(p, 'utf8')),
    ['the plan', 'first log', 'second'],
  );
  fs.writeFileSync(path.join(cwd, 'plan.md'), 'edited later');
  assert.equal(fs.readFileSync(paths[0]!, 'utf8'), 'the plan', 'the copy is a snapshot');
});

test('a file already under files/ is posted by its own path', async () => {
  const { env, joinAs, store, root } = await installed();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  const saved = path.join(filesDir(root), 'codex-notes.md');
  fs.writeFileSync(saved, 'long notes');
  message({ text: 'Summary.', attach: [saved], cwd: '/', env: env('p1') });
  const post = store()
    .queued('claude')
    .find((q) => q.kind === 'message');
  assert.deepEqual(attachedPaths(post!.text), [saved]);
});

test('a post with a missing file, a folder or too long a text queues and copies nothing', async () => {
  const { env, joinAs, store, root } = await installed();
  await joinAs('p1', 'codex');
  await joinAs('p2', 'claude');
  const cwd = workdir({ 'ok.md': 'fine', 'dir/x.md': 'x' });
  const files = (): string[] => fs.readdirSync(filesDir(root));
  const before = files();
  assert.throws(
    () => message({ text: 'hi', attach: ['ok.md', 'missing.md'], cwd, env: env('p1') }),
    /^Error: Not queued: cannot attach missing\.md: no readable file at /,
  );
  assert.throws(
    () => message({ text: 'hi', attach: ['dir'], cwd, env: env('p1') }),
    /cannot attach dir: it is not a regular file/,
  );
  assert.throws(
    () =>
      message({
        text: 'x'.repeat(MAX_MESSAGE_CHARS - 10),
        attach: ['ok.md'],
        cwd,
        env: env('p1'),
      }),
    /too long/,
    'the listed paths count toward the cap',
  );
  assert.deepEqual(
    store()
      .queued('claude')
      .filter((q) => q.kind === 'message'),
    [],
  );
  assert.deepEqual(files(), before);
});
