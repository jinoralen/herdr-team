import { expect, test } from 'bun:test';
import { cli } from './run-cli.ts';

test('two agents exchange a multiline message through real CLI processes', async () => {
  const { run, prompts } = cli();
  expect((await run(['tick'])).code).toBe(0);
  expect((await run(['join', 'codex'], { inPane: true })).code).toBe(0);
  expect((await run(['join', 'claude'], { inPane: true, paneId: 'p2' })).code).toBe(0);
  expect((await run(['tick'])).code).toBe(0);
  const text = '@claude review this\nsecond line with $(literal text)';
  const posted = await run(['message', '--stdin'], { inPane: true, stdin: text });
  expect(posted.code).toBe(0);
  expect((await run(['tick'])).code).toBe(0);
  expect(prompts()).toContain('p2: [herdr-team to=@claude');
  expect(prompts()).toContain(text);
  expect(prompts()).not.toContain('p1:');
  const status = await run(['status'], { inPane: true, paneId: 'p2' });
  expect(status.code).toBe(0);
  expect(status.stdout).toContain('@codex → @claude: @claude review this');
  expect((await run(['leave'], { inPane: true, paneId: 'p2' })).code).toBe(0);
  expect((await run(['tick'])).code).toBe(0);
  const left = await run(['message', 'after leaving'], { inPane: true, paneId: 'p2' });
  expect(left.code).toBe(1);
  expect(left.stderr).toContain('has not joined');
});
