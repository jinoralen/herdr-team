import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDefinition, teamFile } from '../index.ts';

// A fresh folder holding the given files, removed after the test.
function folder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-agents-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const REVIEWER = `---
description: reviews architecture, read-only
kind: claude
model: sonnet
---
Review architecture when the lead assigns work.
Report to the lead.
`;

test('a name loads agents/<name>.md from HERDR_TEAM_DIR', () => {
  const dir = folder({ 'agents/reviewer.md': REVIEWER });
  const definition = loadDefinition('reviewer', { env: { HERDR_TEAM_DIR: dir } });
  assert.deepEqual(definition, {
    file: path.join(dir, 'agents', 'reviewer.md'),
    handle: 'reviewer',
    description: 'reviews architecture, read-only',
    kind: 'claude',
    model: 'sonnet',
    instructions: 'Review architecture when the lead assigns work.\nReport to the lead.',
  });
});

test('without HERDR_TEAM_DIR the folder is $XDG_CONFIG_HOME/herdr-team, else ~/.config/herdr-team', () => {
  const xdg = folder({ 'herdr-team/agents/reviewer.md': REVIEWER.replace('read-only', 'xdg') });
  const home = folder({
    '.config/herdr-team/agents/reviewer.md': REVIEWER.replace('read-only', 'home'),
  });
  const env = { XDG_CONFIG_HOME: xdg, HOME: home };
  assert.equal(loadDefinition('reviewer', { env }).description, 'reviews architecture, xdg');
  assert.equal(
    loadDefinition('reviewer', { env: { HOME: home } }).description,
    'reviews architecture, home',
  );
});

test('a path (with a slash or ending in .md) is read from the caller cwd, its handle from the file name', () => {
  const dir = folder({ 'team/reviewer.md': REVIEWER, 'lead.md': REVIEWER });
  const options = { env: { HERDR_TEAM_DIR: '/nonexistent' }, cwd: dir };
  assert.equal(loadDefinition('team/reviewer.md', options).handle, 'reviewer');
  assert.equal(loadDefinition('./team/reviewer', options).handle, 'reviewer');
  assert.equal(loadDefinition('lead.md', options).handle, 'lead');
  assert.equal(loadDefinition(path.join(dir, 'lead.md'), options).handle, 'lead');
});

test('keys herdr-agent-hub does not use are ignored, so files from other tools load as they are', () => {
  const opencode = `---
description: Read-only task reviewer.
mode: subagent
model: openai/gpt-5.6-terra
permissions:
  - action: edit
    resource: "*"
    effect: deny
tools: [read, grep]
---

Load \`task-review\`.
`;
  const dir = folder({ 'agents/task-reviewer.md': opencode });
  assert.deepEqual(loadDefinition('task-reviewer', { env: { HERDR_TEAM_DIR: dir } }), {
    file: path.join(dir, 'agents', 'task-reviewer.md'),
    handle: 'task-reviewer',
    description: 'Read-only task reviewer.',
    model: 'openai/gpt-5.6-terra',
    instructions: 'Load `task-review`.',
  });
});

test('an invalid definition fails naming its file and what to fix', () => {
  const bad = {
    'no-frontmatter': ['Just a prompt.', /must start with frontmatter between --- lines/],
    'no-description': ['---\nkind: claude\n---\nx', /description/],
    'long-description': [`---\ndescription: ${'a'.repeat(201)}\n---\nx`, /description.*200/],
    'bad-kind': ['---\ndescription: d\nkind: opencode\n---\nx', /kind.*codex, claude or pi/],
    'bad-handle': ['---\ndescription: d\nhandle: Two Words\n---\nx', /handle/],
    'bad-model': ['---\ndescription: d\nmodel: --dangerous\n---\nx', /model/],
    Upper_File: ['---\ndescription: d\n---\nx', /handle/],
  } as const;
  const files = Object.fromEntries(
    Object.entries(bad).map(([n, [text]]) => [`agents/${n}.md`, text]),
  );
  const dir = folder(files);
  for (const [name, [, message]] of Object.entries(bad)) {
    assert.throws(
      () => loadDefinition(name, { env: { HERDR_TEAM_DIR: dir } }),
      (error: Error) =>
        error.message.includes(path.join(dir, 'agents', `${name}.md`)) &&
        message.test(error.message),
      name,
    );
  }
});

test('a missing definition says where definitions go and lists the ones there', () => {
  const dir = folder({
    'agents/reviewer.md': REVIEWER,
    'agents/lead.md': REVIEWER,
    'agents/notes.txt': '',
  });
  const env = { HERDR_TEAM_DIR: dir };
  assert.throws(
    () => loadDefinition('reviwer', { env }),
    new Error(
      `No agent definition "reviwer" in ${path.join(dir, 'agents')}. Definitions there: lead, reviewer.`,
    ),
  );
  const empty = folder({});
  assert.throws(
    () => loadDefinition('reviewer', { env: { HERDR_TEAM_DIR: empty } }),
    new Error(
      `No agent definition "reviewer" in ${path.join(empty, 'agents')}. Create ${path.join(empty, 'agents', 'reviewer.md')}: frontmatter with a description (and kind to start one), then its instructions.`,
    ),
  );
  assert.throws(
    () => loadDefinition('./nope.md', { env, cwd: dir }),
    new Error(`No agent definition file ${path.join(dir, 'nope.md')}.`),
  );
});

test('a definition saved with CRLF line endings loads like one with LF', () => {
  const dir = folder({ 'agents/reviewer.md': REVIEWER.replaceAll('\n', '\r\n') });
  const definition = loadDefinition('reviewer', { env: { HERDR_TEAM_DIR: dir } });
  assert.equal(definition.description, 'reviews architecture, read-only');
  assert.equal(
    definition.instructions,
    'Review architecture when the lead assigns work.\nReport to the lead.',
  );
});

test('a team name is teams/<name>.yaml in the folder; a path is read from the caller cwd', () => {
  const dir = folder({
    'teams/review.yaml': 'name: review\n',
    'teams/audit.yml': '',
    'local.yaml': '',
  });
  const options = { env: { HERDR_TEAM_DIR: dir }, cwd: dir };
  assert.equal(teamFile('review', options), path.join(dir, 'teams', 'review.yaml'));
  assert.equal(teamFile('local.yaml', options), path.join(dir, 'local.yaml'));
  assert.equal(teamFile('./teams/audit.yml', options), path.join(dir, 'teams', 'audit.yml'));
  assert.throws(
    () => teamFile('reviw', options),
    new Error(`No team "reviw" in ${path.join(dir, 'teams')}. Teams there: audit, review.`),
  );
  assert.throws(
    () => teamFile('./none.yaml', options),
    new Error(`No team file ${path.join(dir, 'none.yaml')}.`),
  );
});
