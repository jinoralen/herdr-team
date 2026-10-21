// What `invite` starts: the flags given, and the agent definition for the rest. Both invite modes
// (this pane, launch.ts; another pane, remote.ts) check what they start here.
import { loadDefinition } from '@herdr/agents';
import { sanitizeForTerminal } from '#agent';
import { initialTask, pasteLine } from './prompt.ts';

export type Start = { agent: string; model?: string; handle: string; description: string };

const SUPPORTED = ['codex', 'claude', 'pi'];

// What to start, checked before anything is touched: a supported agent, a terminal-safe
// description, and the initial task (or the default one).
export function prepareStart(
  given: Partial<Start>,
  as: string | undefined,
  prompt: string | undefined,
  env: NodeJS.ProcessEnv,
): Start & { task: string } {
  const start = resolveStart(given, as, env);
  if (!SUPPORTED.includes(start.agent)) {
    throw new Error('Supported agents are codex, claude and pi.');
  }
  return {
    ...start,
    description: sanitizeForTerminal(start.description).trim(),
    task: initialTask(prompt),
  };
}

// A pane where an agent already runs is never typed into: the caller gets the line to paste.
// where: the pane as the message names it; otherwise: another way out, on a line of its own.
export function refuseRunningAgent(
  running: string | null | undefined,
  where: string,
  start: { as?: string; handle: string; description: string },
  otherwise?: string,
): void {
  if (running) {
    const other = otherwise ? `\n${otherwise}` : '';
    throw new Error(`${where} already runs ${running}. Ask it to run: ${pasteLine(start)}${other}`);
  }
}

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
        : 'Starting an agent requires --agent <codex|claude|pi>, or an agent definition with a kind.',
    );
  }
  const handle = given.handle ?? definition?.handle;
  if (!handle) {
    throw new Error('Starting an agent requires --handle <handle>, or an agent definition.');
  }
  const description = given.description ?? definition?.description;
  if (!description) {
    throw new Error('Starting an agent requires --description <text>, or an agent definition.');
  }
  return { agent, model: checkModel(given.model ?? definition?.model), handle, description };
}

// Passed to the harness as one argument, so it must not read as an option or split into words.
function checkModel(model: string | undefined): string | undefined {
  if (
    model !== undefined &&
    (!model || model.startsWith('-') || /\s/u.test(model) || sanitizeForTerminal(model) !== model)
  ) {
    throw new Error(
      'Use a nonempty model identifier without a leading hyphen, spaces or control characters.',
    );
  }
  return model;
}
