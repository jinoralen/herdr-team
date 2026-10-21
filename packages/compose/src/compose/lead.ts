// The managed lead receives its coordinator task through hub, like every helper.
import path from 'node:path';
import { sanitizeForTerminal, shellQuote } from '@herdr/terminal';
import { COMPOSE_SELF } from './hub.ts';
import type { DesiredAgent } from './manifest.ts';

export function coordinatorPrompt(
  name: string,
  file: string,
  agents: Record<string, DesiredAgent>,
  prompt: string,
): string {
  const deployment = shellQuote(path.resolve(file));
  const helpers = Object.entries(agents).map(
    ([key, a]) =>
      `  ${key}: @${a.handle}, ${a.kind}${a.model ? ` / ${a.model}` : ' / harness default'}`,
  );
  return sanitizeForTerminal(`You are the lead for deployment "${name}" in this Herdr workspace.
Hub starts you as @lead; use the room guide above.

Deployment file: ${path.resolve(file)}
Helpers:
${helpers.join('\n') || '  (none)'}

Coordinate helpers according to their purposes in that YAML file. Continue the user's assigned
task, or wait for one if none was assigned. Starting or reconciling a team does not assign work.
After posting messages, end your turn; replies arrive through the room. Do not poll or sleep.

The user manages this deployment from a separate pane:
Team changes: ${COMPOSE_SELF} up ${deployment}
Recorded state: ${COMPOSE_SELF} status
Stop the lead and helpers: ${COMPOSE_SELF} down ${deployment}

${prompt}`);
}
