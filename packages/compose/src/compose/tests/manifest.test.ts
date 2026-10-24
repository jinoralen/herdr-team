import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlan, resolveTeam } from '../manifest.ts';

test('the example team loads with its checked-in definitions', async () => {
  const plan = await loadPlan(
    fileURLToPath(new URL('../../../../../examples/team.yaml', import.meta.url)),
    {},
  );
  assert.equal(plan.name, 'review');
  assert.deepEqual(Object.keys(plan.agents), ['architecture', 'correctness', '$lead']);
  assert.equal(plan.agents.$lead!.kind, 'codex');
});

// A herdr-team folder with a definition and a team using it, and a project folder, removed after.
function folders(): { dir: string; project: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-compose-')));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'herdr-team');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'teams'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'NOTES.md'), 'project notes');
  fs.writeFileSync(
    path.join(dir, 'agents', 'helper.md'),
    '---\ndescription: helps\nkind: claude\n---\n',
  );
  const team = [
    'name: work',
    'lead: { use: ../agents/helper.md }',
    'shared: { files: [NOTES.md] }',
    'tabs: { main: {} }',
    'agents: { coder: { use: helper, tab: main, cwd: src } }',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'teams', 'work.yaml'), team);
  return { dir, project };
}

test('a team works in the folder up runs in; use paths stay relative to the team file', async () => {
  const { dir, project } = folders();
  const env = { HERDR_TEAM_DIR: dir };
  for (const ref of ['work', path.join(dir, 'teams', 'work.yaml')]) {
    const plan = await loadPlan(resolveTeam(ref, env, project), env, project);
    assert.equal(plan.agents.$lead!.cwd, project);
    assert.equal(plan.agents.$lead!.definition, path.join(dir, 'agents', 'helper.md'));
    assert.equal(plan.agents.coder!.cwd, path.join(project, 'src'));
    assert.match(plan.agents.coder!.prompt, /project notes/);
  }
});
