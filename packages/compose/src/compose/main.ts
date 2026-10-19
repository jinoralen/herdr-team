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
  .argument('<team>', 'a team name from ~/.config/herdr-team/teams, or a team file')
  .action(async (file) => {
    const result = await up({
      file,
      herdr: cliLayoutHerdr(),
      interactive: !!process.stdin.isTTY,
    });
    console.log(result.output);
    if (result.launch) {
      execLead(result.launch);
    }
  });
program
  .command('down')
  .summary('dismantle only the agents and tabs owned by a team YAML deployment')
  .argument('<team>', 'a team name or file (only its name: is read)')
  .action(async (file) => {
    console.log(await down({ file, herdr: cliLayoutHerdr() }));
  });
program
  .command('status')
  .summary('show deployments in this workspace')
  .action(() => {
    console.log(status());
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
