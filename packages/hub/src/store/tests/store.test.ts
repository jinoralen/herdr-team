import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { message } from '#agent';
import { tick as runTick } from '#rooms';
import { dbPath, MAX_MESSAGE_CHARS } from '#store';
import { fakeHerdr, installed } from '#testing';

test('message refuses empty, too long and NUL text', async () => {
  const { env, joinAs, root } = await installed();
  await joinAs('p1', 'claude');
  assert.throws(() => message({ text: '  \n', env: env('p1') }), /empty/);
  assert.throws(
    () => message({ text: 'x'.repeat(MAX_MESSAGE_CHARS + 1), env: env('p1') }),
    (error: Error) => {
      const file = error.message.match(/cat > (\S+) <<'EOF'/)![1]!;
      assert.match(
        error.message,
        /^Not queued: the message is too long \(16001 chars, max 16000\)/,
      );
      assert.ok(file.startsWith(`${root}/files/claude-`), file);
      assert.ok(fs.existsSync(path.dirname(file)), 'the directory is there to write into');
      assert.match(error.message, /message \[--to <handle>\] --attach (\S+) --stdin <<'EOF'\n/);
      return true;
    },
  );
  assert.throws(() => message({ text: 'a\0b', env: env('p1') }), /NUL/);
  const paths = new Set(
    [1, 2, 3].map((): string => {
      try {
        message({ text: 'x'.repeat(MAX_MESSAGE_CHARS + 1), env: env('p1') });
      } catch (error) {
        return (error as Error).message.match(/cat > (\S+) <<'EOF'/)![1]!;
      }
      return '';
    }),
  );
  assert.equal(paths.size, 3, 'each too-long post gets its own file');
});

test('the database refuses invalid rows', async () => {
  const { store, joinAs } = await installed();
  await joinAs('p1', 'codex');
  const s = store();
  const to = ['claude'];
  assert.throws(() => s.enqueue('codex', '', to), /CHECK constraint/);
  assert.throws(
    () => s.enqueue('codex', 'x'.repeat(MAX_MESSAGE_CHARS + 1), to),
    /CHECK constraint/,
  );
  const member = s.member('codex')!;
  assert.throws(() => s.saveMember({ ...member, handle: '../bad' }), /CHECK constraint/);
  assert.throws(
    () => s.saveMember({ ...member, handle: 'other', pane_id: 'p2', terminal_id: null }),
    /CHECK constraint/,
  );
});

test('a corrupt database fails visibly and is left untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-team-test-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const garbage = 'this is not a database'.repeat(100);
  fs.writeFileSync(dbPath(root), garbage);
  await assert.rejects(runTick({ root, herdr: fakeHerdr() }), /not a database/);
  assert.equal(fs.readFileSync(dbPath(root), 'utf8'), garbage);
});
