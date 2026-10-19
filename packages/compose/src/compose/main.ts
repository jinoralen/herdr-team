#!/usr/bin/env bun
// Team management has its own executable; hub remains the room relay plugin.
import { Command } from '@commander-js/extra-typings';
import { cliLayoutHerdr } from '@herdr/herdr';
import { down, up } from './commands.ts';
import { COMPOSE_SELF } from './hub.ts';
import { execLead } from './lead.ts';
import { status } from './status.ts';

const program = new Command()
  .name(COMPOSE_SELF)
  .description('Create and reconcile agent teams and tab layouts in Herdr.')
  .showSuggestionAfterError(false);
program
  .command('up')
  .summary('reconcile a team; start a lead in this pane when none is running')
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
      herdr: cliLayoutHerdr(),
      interactive: !!process.stdin.isTTY,
      dryRun,
    });
    console.log(
      options.json
        ? JSON.stringify({
            deployment: result.deployment,
            dryRun,
            changes: result.changes,
            output: result.output,
          })
        : result.output,
    );
    if (result.launch) {
      execLead(result.launch);
    }
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
    console.log(await down({ file, herdr: cliLayoutHerdr(), json: options.json }));
  });
program
  .command('status')
  .summary("show deployments in this workspace and their helpers' room membership")
  .option('--json', 'print the deployments as JSON')
  .action((options) => {
    console.log(status({ json: options.json }));
  });

if (import.meta.main) {
  try {
    if (process.argv.length <= 2) {
      program.outputHelp();
    } else {
      await program.parseAsync();
    }
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
