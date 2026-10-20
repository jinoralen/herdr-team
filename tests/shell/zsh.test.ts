// The zsh completion in shell/zsh/ against the programs it completes: every visible command and
// option is offered, and nothing is offered that no longer exists. A command or option changed in
// main.ts without its completion fails here.

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { program as compose } from '@herdr/compose/cli';
import { program as hub } from '@herdr/hub/cli';

const SHELL = path.join(import.meta.dir, '../../shell');

type Command = (typeof hub)['commands'][number];

// The long and short flags help lists for a command, --help included.
function flags(command: Command): string[] {
  return command
    .createHelp()
    .visibleOptions(command)
    .flatMap((o) => [o.long, o.short])
    .filter((f): f is string => f !== undefined);
}

// The `(name)` branch completing one command: up to its `;;`.
function branch(script: string, name: string): string | null {
  return script.match(new RegExp(`\\n\\s*\\(${name}\\)\\n([\\s\\S]*?);;`))?.[1] ?? null;
}

// The commands the script lists in `commands=( 'name:summary' … )`.
function listed(script: string): string[] {
  const block = script.match(/local -a commands=\(\n([\s\S]*?)\n\)/)?.[1] ?? '';
  return [...block.matchAll(/^\s*'([\w-]+):/gm)].map((m) => m[1] ?? '');
}

const flagsIn = (text: string): string[] => [
  ...new Set([...text.matchAll(/(?<![\w-])--?[a-z][\w-]*(?=[[\],'}])/g)].map((m) => m[0])),
];

for (const [name, program] of [
  ['herdr-hub', hub],
  ['herdr-compose', compose],
] as const) {
  const script = fs.readFileSync(path.join(SHELL, 'zsh', `_${name}`), 'utf8');
  const commands = program
    .createHelp()
    .visibleCommands(program)
    .map((c) => c.name());

  test(`${name}'s zsh completion lists exactly its visible commands`, () => {
    assert.deepEqual(listed(script).sort(), [...commands].sort());
  });

  test(`${name}'s zsh completion offers exactly its top-level options`, () => {
    const top = script.slice(0, script.indexOf('case $state in'));
    assert.deepEqual(
      flagsIn(top.slice(top.indexOf('_arguments -C'))).sort(),
      flags(program).sort(),
    );
  });

  for (const command of program.commands.filter((c) => commands.includes(c.name()))) {
    if (command.name() === 'help') {
      continue;
    }
    test(`${name} ${command.name()}: zsh completion offers exactly its options`, () => {
      const body = branch(script, command.name());
      assert.ok(body !== null, `no (${command.name()}) branch in shell/zsh/_${name}`);
      assert.deepEqual(flagsIn(body).sort(), flags(command).sort());
    });
  }
}

test('the zsh scripts parse', () => {
  const zsh = Bun.which('zsh');
  if (!zsh) {
    return;
  }
  for (const file of ['init.zsh', 'zsh/_herdr-hub', 'zsh/_herdr-compose']) {
    const parsed: { exitCode: number; stderr: Buffer } = Bun.spawnSync([
      zsh,
      '-n',
      path.join(SHELL, file),
    ]);
    assert.equal(parsed.exitCode, 0, `${file}: ${parsed.stderr.toString()}`);
  }
});
