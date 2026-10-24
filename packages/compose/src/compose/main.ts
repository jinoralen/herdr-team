#!/usr/bin/env bun
// Team management has its own executable; hub remains the room relay plugin.
import { Command, CommanderError } from '@commander-js/extra-typings';
import { listTeams } from '@herdr/agents';
import { cliLayoutHerdr, type LayoutHerdr } from '@herdr/herdr';
import { type Exec, spawnExec } from '@herdr/terminal';
import { down, up } from './commands.ts';
import { COMPOSE_SELF, Hub, type HubClient } from './hub.ts';
import { exitCode } from './retry.ts';
import { status } from './status.ts';
import { teams } from './teams.ts';

// exec runs herdr and hub; tests pass one that answers in-process, or replace both clients.
export function createProgram({
  env = process.env,
  exec = spawnExec,
  herdr = cliLayoutHerdr(env, exec),
  hub = new Hub(env, exec),
  cwd = process.cwd(),
  stdout = (text: string): boolean => process.stdout.write(text),
  stderr = (text: string): boolean => process.stderr.write(text),
}: {
  env?: NodeJS.ProcessEnv;
  exec?: Exec;
  herdr?: LayoutHerdr;
  hub?: HubClient;
  cwd?: string;
  stdout?: (text: string) => unknown;
  stderr?: (text: string) => unknown;
} = {}): { program: Command; run: (args: string[]) => Promise<number> } {
  const print = (text: string): void => {
    stdout(`${text}\n`);
  };
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeOut: stdout, writeErr: stderr })
    .name(COMPOSE_SELF)
    .description('Create and reconcile agent teams and tab layouts in Herdr.')
    .showSuggestionAfterError(false);
  program
    .command('up')
    .summary('reconcile a team in separate managed lead and helper panes')
    .argument(
      '[team]',
      'a team name from ~/.config/herdr-team/teams, or a team file (default: ./herdr-team.yaml)',
    )
    .option('--dry-run', 'show what up would create, replace, move and close; change nothing')
    .option('--json', 'print the changes and the output as JSON')
    .action(async (file, options) => {
      const dryRun = options.dryRun ?? false;
      const result = await up({
        file,
        herdr,
        hub,
        env,
        cwd,
        dryRun,
      });
      print(
        options.json
          ? JSON.stringify({
              deployment: result.deployment,
              dryRun,
              changes: result.changes,
              output: result.output,
            })
          : result.output,
      );
    });
  program
    .command('down')
    .summary('dismantle only the agents and tabs owned by a team YAML deployment')
    .argument(
      '[team]',
      "a team name or file, of which only name: is read (default: this workspace's only deployment)",
    )
    .option('--json', 'print the deployment taken down and the handles removed as JSON')
    .action(async (file, options) => {
      print(await down({ file, herdr, hub, env, json: options.json }));
    });
  program
    .command('status')
    .summary("show deployments in this workspace and their helpers' room membership")
    .option('--json', 'print the deployments as JSON')
    .action(async (options) => {
      print(await status({ json: options.json, env, hub }));
    });

  program
    .command('teams')
    .summary('list the teams in ~/.config/herdr-team/teams and check each one')
    .option('--json', 'print the teams as JSON')
    .action(async (options) => {
      print(await teams({ json: options.json, env }));
    });

  // Run by the zsh completion (shell/zsh/_herdr-compose) on Tab: up and down's team names, one
  // "name<TAB>file" per line. Only reads the folder, and prints nothing rather than failing.
  program
    .command('__complete', { hidden: true })
    .argument('<what>', 'teams')
    .action((what) => {
      try {
        const names = what === 'teams' ? listTeams({ env }).teams : [];
        if (names.length) {
          print(names.map(({ name, file }) => `${name}\t${file}`).join('\n'));
        }
      } catch {
        /* no completion */
      }
    });

  async function run(args: string[]): Promise<number> {
    try {
      if (args.length === 0) {
        program.outputHelp();
      } else {
        await program.parseAsync(args, { from: 'user' });
      }
      return 0;
    } catch (error) {
      if (error instanceof CommanderError) {
        return error.exitCode;
      }
      stderr(`error: ${(error as Error).message}\n`);
      return exitCode(error);
    }
  }
  return { program, run };
}

// Exported for the zsh completion checks.
export const program: Command = createProgram().program;

if (import.meta.main) {
  process.exitCode = await createProgram().run(process.argv.slice(2));
}
