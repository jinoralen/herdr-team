#!/usr/bin/env bun
// The command line: one definition per command, with its options, help and what it runs.
// Agents run the room commands; Herdr runs `tick`.

import { Command, CommanderError } from '@commander-js/extra-typings';
import { cliHerdr } from '@herdr/herdr';
import { type Exec, spawnExec } from '@herdr/terminal';
import { exitCode, guide, join, leave, message, orientation, parseTo, SELF, status } from '#agent';
import { version } from '#package';
import { tick } from '#rooms';
import { appendLog, rootDir } from '#store';
import { agents } from './agents.ts';
import { complete } from './complete.ts';
import { launch } from './launch.ts';
import { invite, UncertainStartup } from './remote.ts';
import { unknownCommand } from './unknown.ts';

// What a run of the command line touches outside its state directory: the commands it runs (herdr),
// the agent invite takes the terminal over with, and its own IO.
export type System = {
  exec: Exec;
  which: typeof Bun.which;
  execve: typeof process.execve | undefined;
  stdout: (text: string) => unknown;
  stderr: (text: string) => unknown;
  stdin: () => Promise<string>;
  isTTY: { stdin: boolean; stdout: boolean };
};

const processSystem = (): System => ({
  exec: spawnExec,
  which: Bun.which,
  execve: process.execve,
  stdout: (text: string): boolean => process.stdout.write(text),
  stderr: (text: string): boolean => process.stderr.write(text),
  stdin: (): Promise<string> => Bun.stdin.text(),
  isTTY: { stdin: !!process.stdin.isTTY, stdout: !!process.stdout.isTTY },
});

// A fresh parser per invocation: tests replace any part of the system without changing global state.
export function createProgram({
  env = process.env,
  ...given
}: { env?: NodeJS.ProcessEnv } & Partial<System> = {}): {
  program: Command;
  run: (args: string[]) => Promise<number>;
} {
  const { exec, which, execve, stdout, stderr, stdin, isTTY } = { ...processSystem(), ...given };
  const herdr = cliHerdr(env, exec);
  let code = 0;
  const print = (text: string): void => {
    stdout(`${text}\n`);
  };
  const printError = (text: string): void => {
    stderr(`${text}\n`);
  };
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeOut: stdout, writeErr: stderr })
    .name(SELF)
    .description(
      'Chat rooms for coding agents running in Herdr, one room per workspace.\n' +
        'Agents join and post with this command; Herdr runs it when agents change state, so nothing stays running.',
    )
    .showSuggestionAfterError(false)
    .version(version, '-v, --version', 'print the version')
    .addHelpText('before', () => orientation({ env }))
    .addHelpText('after', `\nAgents: run \`${SELF} guide\` to learn how to use the room.`)
    .commandsGroup('Agent commands:');

  // The [agent] argument of join and invite, which read definitions the same way.
  const AGENT = 'an agent definition from ~/.config/herdr-team/agents (name or path)';

  program
    .command('join')
    .summary("join this pane's room (agent)")
    .description(
      "Join the chat room of this pane's Herdr workspace, as the agent running the command.\n" +
        'An agent runs it in its own shell, when its user asks: as an agent definition, or\n' +
        'with --description. Without --handle, the handle comes from the definition, or the\n' +
        'first word of the description (@codex, @claude-2, ...); the description is the role\n' +
        'the others see. Prints instructions for the agent on how to use the room.\n' +
        'Running it again from the same pane prints the instructions again.\n' +
        'To start an agent, use invite.',
    )
    .argument('[agent]', AGENT)
    .option('-d, --description <text>', 'short role shown to the other members')
    .option('--handle <handle>', 'use this exact handle; fail if it is occupied')
    .action((agent, options) => {
      print(join({ as: agent, description: options.description, handle: options.handle, env }));
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
      const fromStdin = options.stdin || (words.length === 0 && !isTTY.stdin);
      const text = fromStdin ? await stdin() : words.join(' ');
      print(
        message({
          text,
          to: options.to,
          re: options.re,
          fyi: options.fyi,
          attach: options.attach,
          env,
        }),
      );
    });

  program
    .command('guide')
    .summary('how to use the room: your handle, members, rules (agent)')
    .description(
      "Print the guide for agents. In a pane that joined, it is that agent's own: its\n" +
        "handle, the room's members and its rules, as join printed them. Elsewhere, a general\n" +
        'guide. It only reads, so run it whenever the rules are no longer in your context.',
    )
    .action(() => {
      print(guide({ env }));
    });

  program
    .command('leave')
    .summary('leave the room (agent)')
    .description('Leave your room. Others are told you left; you get no more deliveries.')
    .action(() => {
      print(leave({ env }));
    });

  program.commandsGroup('User commands:').helpCommand(true);

  program
    .command('invite')
    .summary('start an agent in this or another shell pane and bring it into its room')
    .description(
      "Start an agent and bring it into its pane's room. Without --pane, in this\n" +
        'interactive Herdr shell: the agent takes over the terminal. With --pane, in that\n' +
        'existing shell pane: waits until the agent is a member, submits its guide and\n' +
        'returns. Run by a user, or by a lead agent bringing in helpers; only that pane is\n' +
        'ever touched. A pane where an agent already runs is refused, with the line to\n' +
        'paste into that agent.',
    )
    .argument('[agent]', AGENT)
    .option('--pane <pane>', 'start in this shell pane instead of the current one, e.g. w1:p3')
    .option('--agent <type>', "codex, claude or pi; overrides the definition's kind")
    .option('--handle <handle>', 'use this exact handle; fail if it is occupied')
    .option('-d, --description <text>', 'short role shown to the other members')
    .option('--model <id>', 'model for the agent, passed to it unchanged')
    .option('--prompt <text>', 'initial task after the guide')
    .option(
      '--json',
      'with --pane: print the outcome as JSON, failures and uncertain ones included',
    )
    .action(async (agent, { pane, json, ...options }) => {
      const start = { ...options, as: agent, env, herdr };
      if (pane === undefined) {
        if (json) {
          throw new Error('--json needs --pane: without it, the agent takes over this terminal.');
        }
        await launch(start, {
          isTTY: isTTY.stdin && isTTY.stdout,
          which,
          execve,
        });
      } else if (json) {
        await inviteJson({ ...start, pane });
      } else {
        print((await invite({ ...start, pane })).text);
      }
    });

  // invite --pane --json: one JSON line on stdout whatever happens, for a lead or script to read.
  // uncertain: startup began and may have left the agent or its guide behind; look before retrying.
  async function inviteJson(start: Parameters<typeof invite>[0]): Promise<void> {
    try {
      const { text: _, ...invited } = await invite(start);
      print(JSON.stringify({ ok: true, ...invited, uncertain: false }));
    } catch (error) {
      const uncertain = error instanceof UncertainStartup;
      print(JSON.stringify({ ok: false, error: (error as Error).message, uncertain }));
      code = exitCode(error);
    }
  }

  program
    .command('agents')
    .summary('list the agent definitions join and invite can use')
    .description(
      "List the agent definitions in ~/.config/herdr-team/agents: each one's handle, kind,\n" +
        'model and description, and what is wrong with any that cannot be used. Only reads\n' +
        'the folder.',
    )
    .option('--json', 'print the definitions as JSON')
    .action((options) => {
      print(agents({ json: options.json, env }));
    });

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
      print(status({ json: options.json, env }));
    });

  // Run by Herdr, not by users or agents: left out of help, which agents read.
  program
    .command('tick', { hidden: true })
    .summary('bring rooms up to date once (run by Herdr)')
    .description(
      'Bring every room up to date once: admit joins, handle posts, deliver messages\n' +
        'to agents that are idle, then exit. The herdr-team Herdr plugin runs it when an\n' +
        'agent changes state; running it by hand is harmless.',
    )
    .option('--startup', "Herdr's server just started: clear every room first (agents join again)")
    .action(async (options) => {
      await runTick(options.startup ?? false);
    });

  // Run by the zsh completion (shell/zsh/_herdr-hub) on Tab: left out of help.
  program
    .command('__complete', { hidden: true })
    .argument('<what>', 'definitions or handles')
    .action((what) => {
      const values = complete(what, { env });
      if (values) {
        print(values);
      }
    });

  // A usage mistake names the command's own help. An unknown command lists the commands and, for the
  // usual guesses (an inbox to read, `send`), says how the room works instead.
  program.showHelpAfterError(`(${SELF} --help lists the commands)`);
  for (const command of program.commands) {
    command.showHelpAfterError(`(${SELF} ${command.name()} --help shows its usage)`);
  }
  program.on('command:*', ([name]: string[]) => {
    printError(
      unknownCommand(
        name ?? '',
        // As help lists them: hidden ones (tick, __complete) left out.
        program
          .createHelp()
          .visibleCommands(program)
          .map((c) => c.name()),
      ),
    );
    code = 1;
  });

  // Without HERDR_SOCKET_PATH, a tick can't tell which Herdr session started, so clearing could empty
  // another session's rooms: the rooms are kept instead.
  function startupKnown(
    startup: boolean,
    log: (room: string | null, text: string) => void,
  ): boolean {
    if (startup && !env.HERDR_SOCKET_PATH) {
      log(null, '! tick --startup without HERDR_SOCKET_PATH: rooms were not cleared.');
      return false;
    }
    return startup;
  }

  // Run by Herdr hooks. Output goes to Herdr's plugin log; what matters is logged for `status`.
  async function runTick(startup: boolean): Promise<void> {
    const root = rootDir(env);
    const log = (room: string | null, text: string): void => appendLog(root, room, text);
    try {
      await tick({
        root,
        herdr,
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

  // Commander reports usage errors through the same output as the executable, but never exits
  // the host process. Operational errors keep their own retry exit code.
  async function run(args: string[]): Promise<number> {
    try {
      if (args.length === 0) {
        program.outputHelp();
      } else {
        await program.parseAsync(args, { from: 'user' });
      }
    } catch (error) {
      if (error instanceof CommanderError) {
        return error.exitCode;
      }
      printError(`error: ${(error as Error).message}`);
      code = exitCode(error);
    }
    return code;
  }
  return { program, run };
}

// Exported for the zsh completion checks.
export const program: Command = createProgram().program;

if (import.meta.main) {
  process.exitCode = await createProgram().run(process.argv.slice(2));
}
