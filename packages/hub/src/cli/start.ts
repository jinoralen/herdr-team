// What `invite` starts: the flags given, and the agent definition for the rest.
import { loadDefinition } from '@herdr/agents';
import { sanitizeForTerminal } from '#agent';

export type Start = { agent: string; model?: string; handle: string; description: string };

export function resolveStart(
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
