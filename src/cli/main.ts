#!/usr/bin/env bun
// The command line: one definition per command, with its options, help and what it runs.
// Agents run the room commands; Herdr runs `tick`.

import { Command } from '@commander-js/extra-typings';
import { join, leave, message, parseTo, SELF, skill, status } from '#agent';
import { cliHerdr } from '#herdr';
import { tick } from '#rooms';
import { appendLog, rootDir } from '#store';

const program = new Command()
  .name(SELF)
  .description(
    'Chat rooms for coding agents running in Herdr, one room per workspace.\n' +
      'Agents join and post with this command; Herdr runs it when agents change state, so nothing stays running.',
  )
  .showSuggestionAfterError(false)
  .addHelpText('after', `\nAgents: run \`${SELF} skill\` to learn how to use the room.`);

program
  .command('join')
  .summary("join this workspace's room and get instructions (agent)")
  .description(
    "Join the chat room of this pane's Herdr workspace. Run it inside the agent\n" +
      '(e.g. tell the agent to run it). The first word becomes the handle (@codex,\n' +
      "@claude-2, ...); the rest describes the agent's role to the others.\n" +
      'Prints instructions for the agent on how to use the room.\n' +
      'Running it again from the same pane prints the instructions again.',
  )
  .argument('<description...>', 'the agent type, then its role')
  .action((description) => {
    console.log(join({ description: description.join(' ') }));
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
  .action(async (words, options) => {
    const fromStdin = options.stdin || (words.length === 0 && !process.stdin.isTTY);
    const text = fromStdin ? await Bun.stdin.text() : words.join(' ');
    console.log(message({ text, to: options.to, re: options.re, fyi: options.fyi }));
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

program
  .command('status')
  .summary("show the room's members, what waits for them and recent activity")
  .description(
    "Show the current Herdr workspace's room: its members, messages not delivered\n" +
      'yet and why, and the last things ticks did. Only reads; run it from any pane in\n' +
      'the workspace to see why a conversation stopped.',
  )
  .action(() => {
    console.log(status());
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

// Run by Herdr hooks. Output goes to Herdr's plugin log; what matters is logged for `status`.
async function runTick(startup: boolean): Promise<void> {
  const root = rootDir();
  const log = (room: string | null, text: string): void => appendLog(root, room, text);
  try {
    await tick({
      root,
      herdr: cliHerdr(),
      log,
      startup,
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
