// Starts a room member in the user's current Herdr shell pane, with its guide as the first prompt.
import { cliHerdr } from '@herdr/herdr';
import { join, SELF, sanitizeForTerminal } from '#agent';
import { initialTask, joinLine, memberPrompt, pasteLine } from './prompt.ts';
import { resolveStart, type Start } from './start.ts';

function callerPane(env: NodeJS.ProcessEnv): string {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
    throw new Error('Start the agent from an interactive shell inside a Herdr pane.');
  }
  return env.HERDR_PANE_ID;
}

export async function launch({
  as,
  prompt,
  env = process.env,
  ...given
}: Partial<Start> & {
  as?: string;
  prompt?: string;
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
  const current = callerPane(env);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Starting an agent requires an interactive terminal.');
  }
  const binary = Bun.which(agent, { PATH: env.PATH });
  if (!binary) {
    throw new Error(
      `Cannot start ${agent}: it is not on PATH. Install it and retry ${SELF} invite.`,
    );
  }
  if (!process.execve) {
    throw new Error(
      'This Bun runtime cannot start the agent. Use a Bun version with process.execve support.',
    );
  }
  const pane = await cliHerdr(env).pane(current);
  if (!pane) {
    throw new Error(
      `The current Herdr pane no longer exists. Run ${SELF} invite from its current shell.`,
    );
  }
  description = sanitizeForTerminal(description).trim();
  if (pane.agent) {
    throw new Error(
      `${pane.agent} is already running in this pane. Ask it to run: ${pasteLine({ as, handle, description })}`,
    );
  }
  const guide = join({ as, description, handle, env });
  // A tick may have rejected the pending join while the pane was still a shell.
  const confirm = joinLine({ as, handle, description });
  const instructions = `Your user asked you to join the room as @${handle} with this role: ${description}\n\nFirst confirm your membership by running: ${confirm}\nUse the returned guide. If joining fails, report the error to your user and stop.\n\n${guide}`;
  const initial = memberPrompt(instructions, task);
  const inherited = Object.fromEntries(
    Object.entries(env).filter((entry) => entry[1] !== undefined),
  );
  return process.execve(binary, [binary, ...args, '--', initial], inherited);
}

// The model was checked by resolveStart.
function modelArgs(model: string | undefined): string[] {
  return model === undefined ? [] : ['--model', model];
}
