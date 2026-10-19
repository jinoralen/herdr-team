#!/usr/bin/env bun
// The command line: one definition per command, with its options, help and what it runs.
// Agents run the room commands; Herdr runs `tick`.

import { Command } from '@commander-js/extra-typings';
import { cliHerdr } from '@herdr/herdr';
import { join, leave, message, orientation, parseTo, SELF, skill, status } from '#agent';
import { version } from '#package';
import { tick } from '#rooms';
import { appendLog, rootDir } from '#store';
import { launch } from './launch.ts';
import { unknownCommand } from './unknown.ts';

const program = new Command()
  .name(SELF)
  .description(
    'Chat rooms for coding agents running in Herdr, one room per workspace.\n' +
      'Agents join and post with this command; Herdr runs it when agents change state, so nothing stays running.',
  )
  .showSuggestionAfterError(false)
  .version(version, '-v, --version', 'print the version')
  .addHelpText('before', () => orientation())
  .addHelpText('after', `\nAgents: run \`${SELF} skill\` to learn how to use the room.`)
  .commandsGroup('Agent commands:');

function joinDescription(words: string[], named: string | undefined): string {
  if (named !== undefined && words.length > 0) {
    throw new Error('Use either --description or a positional description, not both.');
  }
  if (named === undefined && words.length === 0) {
    throw new Error("missing required argument 'description'");
  }
  return named ?? words.join(' ');
}

program
  .command('join')
  .summary("join a pane's room, optionally starting an agent")
  .description(
    "Join the chat room of this pane's Herdr workspace. An agent runs it in its own\n" +
      'shell, when its user asks. Without --handle, the first word becomes the handle\n' +
      "(@codex, @claude-2, ...); the rest describes the agent's role to the others.\n" +
      'Prints instructions for the agent on how to use the room.\n' +
      'Running it again from the same pane prints the instructions again.\n' +
      '\n' +
      'Users, not agents: from an interactive Herdr shell, use --agent and --handle\n' +
      'to start an agent in this pane with the room guide as its initial prompt.\n' +
      'Add --pane to start in another existing shell pane and return after\n' +
      'confirmation and guide submission.',
  )
  .argument('[description...]', 'the agent type, then its role (or use --description)')
  .option('--description <text>', 'short role shown to the other members')
  .option('--handle <handle>', 'use this exact handle; fail if it is occupied')
  .optionsGroup('Starting an agent (run by the user from a shell, not by agents):')
  .option('--agent <type>', 'start codex, claude or pi in the selected shell pane')
  .option('--model <id>', 'model for the agent being started (requires --agent)')
  .option('--pane <id>', 'start in this existing shell pane (requires --agent)')
  .option('--prompt <text>', 'initial task after joining (requires --agent)')
  .action(async (description, options) => {
    const role = joinDescription(description, options.description);
    if (options.pane && !options.agent) {
      throw new Error('--pane requires --agent <type>.');
    }
    if (options.prompt !== undefined && !options.agent) {
      throw new Error('--prompt requires --agent <type>.');
    }
    if (options.model !== undefined && !options.agent) {
      throw new Error('--model requires --agent <type>.');
    }
    if (options.agent) {
      if (!options.handle) {
        throw new Error('Starting an agent requires --handle <handle>.');
      }
      const output = await launch({
        agent: options.agent,
        model: options.model,
        handle: options.handle,
        description: role,
        prompt: options.prompt,
        pane: options.pane,
      });
      console.log(output);
    } else {
      console.log(join({ description: role, handle: options.handle }));
    }
  });

program
  .command('message')
  .summary('post to the room (agent)')
  .description(
    'Post to your room, as the agent that joined from this pane. It goes to every\n' +
      'other agent, or only to the ones named with --to. Prints whom it is queued for.\n' +
      'Use --re to say which message it answers, and --fyi when it needs no reply.\n' +
      'After posting, end your turn: the post goes out then, and replies are\n' +
      'delivered to you.',
  )
  .argument('[text...]', 'the message (or use --stdin)')
  .option(
    '--to <handles>',
    'send only to these agents, comma-separated (e.g. --to codex,pi)',
    parseTo,
  )
  .option('--re <id>', 'the message this answers, from a delivery header (e.g. --re m12)')
  .option('--fyi', 'no reply needed: wakes nobody, arrives with their next message')
  .option('--stdin', 'read the message from standard input (use for multi-line text)')
  .option(
    '--attach <file>',
    "attach a file (repeat for more): the others get a copy's path",
    (file: string, files: string[]) => [...files, file],
    [] as string[],
  )
  .action(async (words, options) => {
    const fromStdin = options.stdin || (words.length === 0 && !process.stdin.isTTY);
    const text = fromStdin ? await Bun.stdin.text() : words.join(' ');
    console.log(
      message({ text, to: options.to, re: options.re, fyi: options.fyi, attach: options.attach }),
    );
  });

program
  .command('skill')
  .summary('how to use the room: your handle, members, rules (agent)')
  .description(
    "Print the guide for agents. In a pane that joined, it is that agent's own: its\n" +
      "handle, the room's members and its rules, as join printed them. Elsewhere, a general\n" +
      'guide. It only reads, so run it whenever the rules are no longer in your context.',
  )
  .action(() => {
    console.log(skill());
  });

program
  .command('leave')
  .summary('leave the room (agent)')
  .description('Leave your room. Others are told you left; you get no more deliveries.')
  .action(() => {
    console.log(leave());
  });

program.commandsGroup('Other commands:').helpCommand(true);

program
  .command('status')
  .summary("show the room's members, what waits for them and recent activity")
  .description(
    "Show the current Herdr workspace's room: its members, messages not delivered\n" +
      'yet and why, and the last things ticks did. Only reads; run it from any pane in\n' +
      'the workspace to see why a conversation stopped.',
  )
  .option('--json', 'print a membership snapshot for automation')
  .action((options) => {
    console.log(status({ json: options.json }));
  });

program
  .command('tick')
  .summary('bring rooms up to date once (run by Herdr)')
  .description(
    'Bring every room up to date once: admit joins, handle posts, deliver messages\n' +
      'to agents that are idle, then exit. The herdr-agent-hub Herdr plugin runs it when an\n' +
      'agent changes state; running it by hand is harmless.',
  )
  .option('--startup', "Herdr's server just started: clear every room first (agents join again)")
  .action(async (options) => {
    await runTick(options.startup ?? false);
  });

// A usage mistake names the command's own help. An unknown command lists the commands and, for the
// usual guesses (an inbox to read, `send`), says how the room works instead.
program.showHelpAfterError(`(${SELF} --help lists the commands)`);
for (const command of program.commands) {
  command.showHelpAfterError(`(${SELF} ${command.name()} --help shows its usage)`);
}
program.on('command:*', ([name]: string[]) => {
  console.error(
    unknownCommand(
      name ?? '',
      program.commands.map((c) => c.name()),
    ),
  );
  process.exitCode = 1;
});

// Without HERDR_SOCKET_PATH, a tick can't tell which Herdr session started, so clearing could empty
// another session's rooms: the rooms are kept instead.
function startupKnown(startup: boolean, log: (room: string | null, text: string) => void): boolean {
  if (startup && !process.env.HERDR_SOCKET_PATH) {
    log(null, '! tick --startup without HERDR_SOCKET_PATH: rooms were not cleared.');
    return false;
  }
  return startup;
}

// Run by Herdr hooks. Output goes to Herdr's plugin log; what matters is logged for `status`.
async function runTick(startup: boolean): Promise<void> {
  const root = rootDir();
  const log = (room: string | null, text: string): void => appendLog(root, room, text);
  try {
    await tick({
      root,
      herdr: cliHerdr(),
      log,
      startup: startupKnown(startup, log),
    });
  } catch (error) {
    try {
      log(null, `error: ${(error as Error).message}`);
    } catch {
      /* the database itself may be the problem */
    }
    throw error;
  }
}

// Commander reports usage mistakes itself. Errors from running a command
// already say what to do next, so they are printed alone.
async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    program.outputHelp();
    return;
  }
  try {
    await program.parseAsync();
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
