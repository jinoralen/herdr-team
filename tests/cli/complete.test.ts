import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { cli } from './run-cli.ts';

test('__complete lists the definitions that load, with their descriptions', async () => {
  const { run, root } = cli();
  const agents = path.join(root, 'team', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(
    path.join(agents, 'reviewer.md'),
    '---\ndescription: reviews\tarchitecture\n---\n',
  );
  fs.writeFileSync(path.join(agents, 'broken.md'), 'no frontmatter\n');
  const { stdout, code } = await run(['__complete', 'definitions']);
  expect(code).toBe(0);
  expect(stdout).toBe('reviewer\treviews architecture\n');
});

test("__complete lists the other active members of the pane's room, and nothing outside it", async () => {
  const { run } = cli();
  await run(['tick']);
  await run(['join', '--description', 'codex'], { inPane: true });
  await run(['join', '--description', 'claude'], { inPane: true, paneId: 'p2' });
  await run(['tick']);
  expect((await run(['__complete', 'handles'], { inPane: true })).stdout).toBe('claude\tclaude\n');
  expect((await run(['__complete', 'handles'])).stdout).toBe('');
});

test('__complete prints nothing for what it does not know, and stays out of help', async () => {
  const { run } = cli();
  const unknown = await run(['__complete', 'nonsense']);
  expect([unknown.code, unknown.stdout, unknown.stderr]).toEqual([0, '', '']);
  expect((await run(['--help'])).stdout).not.toContain('__complete');
});
