// Starts a room member in the user's current Herdr shell pane, with its guide as the first prompt.
import { loadDefinition } from '@herdr/agents';
import { cliHerdr } from '@herdr/herdr';
import { shellQuote } from '@herdr/terminal';
import { join, SELF, sanitizeForTerminal } from '#agent';
import { initialTask, memberPrompt } from './prompt.ts';
import { launchInPane } from './remote.ts';

function callerPane(env: NodeJS.ProcessEnv): string {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
    throw new Error('Start the agent from an interactive shell inside a Herdr pane.');
  }
  return env.HERDR_PANE_ID;
}

type Start = { agent: string; model?: string; handle: string; description: string };

// What to start: the flags given, and the definition (--as) for the ones left out.
function resolveStart(
  given: Partial<Start>,
  as: string | undefined,
  env: NodeJS.ProcessEnv,
): Start {
  const definition = as === undefined ? null : loadDefinition(as, { env });
  const agent = given.agent ?? definition?.kind;
  if (!agent) {
    throw new Error(
      definition
        ? `The definition ${as} has no kind. Add kind: codex, claude or pi to it, or pass --agent <kind>.`
        : 'Starting an agent requires --agent <codex|claude|pi>, or --as a definition with a kind.',
    );
  }
  const handle = given.handle ?? definition?.handle;
  const description = given.description ?? definition?.description;
  if (!handle || !description) {
    throw new Error('Starting an agent requires --handle <handle>, or --as a definition.');
  }
  return { agent, model: given.model ?? definition?.model, handle, description };
}

export async function launch({
  as,
  prompt,
  pane: target,
  env = process.env,
  ...given
}: Partial<Start> & {
  as?: string;
  prompt?: string;
  pane?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const start = resolveStart(given, as, env);
  const { agent, model, handle } = start;
  let { description } = start;
  if (!['codex', 'claude', 'pi'].includes(agent)) {
    throw new Error('Supported agents are codex, claude and pi.');
  }
  const args = modelArgs(model);
  const task = initialTask(prompt);
  if (target && target !== env.HERDR_PANE_ID) {
    return launchInPane({ agent, as, model, handle, description, task, pane: target, env });
  }
  const current = callerPane(env);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Starting an agent requires an interactive terminal.');
  }
  const binary = Bun.which(agent, { PATH: env.PATH });
  if (!binary) {
    throw new Error(`Cannot start ${agent}: it is not on PATH. Install it and retry ${SELF} join.`);
  }
  if (!process.execve) {
    throw new Error(
      'This Bun runtime cannot start the agent. Use a Bun version with process.execve support.',
    );
  }
  const pane = await cliHerdr(env).pane(current);
  if (!pane) {
    throw new Error(
      `The current Herdr pane no longer exists. Run ${SELF} join from its current shell.`,
    );
  }
  if (pane.agent) {
    throw new Error(
      `An agent is already running in this pane. Run ${SELF} join without --agent inside that agent.`,
    );
  }
  description = sanitizeForTerminal(description).trim();
  const guide = join({ as, description, handle, env });
  // A tick may have rejected the pending join while the pane was still a shell.
  const definition = as === undefined ? '' : ` --as ${shellQuote(as)}`;
  const confirm = `${SELF} join${definition} --handle ${shellQuote(handle)} -- ${shellQuote(description)}`;
  const instructions = `Your user asked you to join the room as @${handle} with this role: ${description}\n\nFirst confirm your membership by running: ${confirm}\nUse the returned guide. If joining fails, report the error to your user and stop.\n\n${guide}`;
  const initial = memberPrompt(instructions, task);
  const inherited = Object.fromEntries(
    Object.entries(env).filter((entry) => entry[1] !== undefined),
  );
  return process.execve(binary, [binary, ...args, '--', initial], inherited);
}

function modelArgs(model: string | undefined): string[] {
  if (model === undefined) {
    return [];
  }
  if (
    !model ||
    model.startsWith('-') ||
    /\s/u.test(model) ||
    sanitizeForTerminal(model) !== model
  ) {
    throw new Error(
      'Use a nonempty model identifier without a leading hyphen, spaces or control characters.',
    );
  }
  return ['--model', model];
}
