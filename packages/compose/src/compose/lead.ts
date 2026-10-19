// The caller coordinates the team: print instructions for an existing agent, or hand the shell
// directly to a configured lead after reconciliation has released its deployment lock.
import path from 'node:path';
import type { Agent } from '@herdr/herdr';
import { sanitizeForTerminal, shellQuote } from '@herdr/terminal';
import type { Membership } from './hub.ts';
import { COMPOSE_SELF, Hub } from './hub.ts';
import type { LeadConfig, ManifestPlan } from './manifest.ts';

// Hub accepts initial tasks up to 80 KB. Validate before creating helper panes.
const MAX_LEAD_PROMPT_BYTES = 80_000;

export function isCallerMember(member: Membership | null, current: Agent | null): boolean {
  return (
    !!current?.agent &&
    !!member &&
    (member.status === 'pending' ||
      (member.terminal_id === current.terminal_id && member.agent === current.agent))
  );
}

export type UpResult = { output: string; launch?: LeadConfig };

export function prepareLead({
  plan,
  file,
  hub,
  pane,
  current,
  leadHandle,
  interactive,
}: {
  plan: ManifestPlan;
  file: string;
  hub: Hub;
  pane: string;
  current: Agent | null;
  leadHandle: string;
  interactive: boolean;
}): UpResult {
  const running = !!current?.agent;
  if (!running && !interactive) {
    throw new Error(
      'No agent is recognized in this pane. Run up from an interactive Herdr shell to start its configured lead.',
    );
  }
  if (!running && !plan.lead) {
    throw new Error(
      'No agent is running in this pane. Add a lead (lead: use: <definition with a kind>) to the team file before running up from a shell.',
    );
  }
  const joined = validateLeadHandle(hub, pane, leadHandle, current, plan);
  const prompt = coordinatorPrompt(plan, file, leadHandle, joined, hub.command);
  if (Buffer.byteLength(prompt) > MAX_LEAD_PROMPT_BYTES) {
    throw new Error(
      'The lead prompt exceeds 80 KB. Shorten lead.prompt or the team before running up.',
    );
  }
  if (running) {
    return { output: prompt };
  }
  // The preceding checks establish this for a shell; keep narrowing explicit for callers.
  if (!plan.lead) {
    throw new Error('The shell has no lead configuration.');
  }
  return {
    output: `Starting the ${plan.lead.kind} lead in this pane.`,
    launch: {
      ...plan.lead,
      prompt: prompt.replace(
        /First join as @[^\n]+/,
        'Hub starts you as @lead; use the room guide above.',
      ),
    },
  };
}

function validateLeadHandle(
  hub: Hub,
  pane: string,
  leadHandle: string,
  current: Agent | null,
  plan: ManifestPlan,
): boolean {
  const member = hub.memberByPane(pane);
  const joined = isCallerMember(member, current);
  const occupied = hub.member(leadHandle);
  if (
    occupied &&
    occupied.pane_id !== pane &&
    (['active', 'pending'].includes(occupied.status) || occupied.queuedFrom)
  ) {
    throw new Error(
      `Handle @${leadHandle} is already in use in another pane. Run up from that lead's pane or choose another room.`,
    );
  }
  if (Object.values(plan.agents).some((a) => a.handle === leadHandle)) {
    throw new Error(
      `The caller coordinates as @${leadHandle}; remove that handle from the managed helper entries.`,
    );
  }
  if (!joined && occupied && occupied.queuedFrom) {
    throw new Error(
      `Handle @${leadHandle} still has undelivered posts from its previous conversation. Let those posts be delivered before retrying up.`,
    );
  }
  return joined;
}

function coordinatorPrompt(
  plan: ManifestPlan,
  file: string,
  handle: string,
  joined: boolean,
  hubCommand: string,
): string {
  const deployment = shellQuote(path.resolve(file));
  const membership = joined
    ? `You are already a member as @${handle}. Read your room guide with: ${hubCommand} skill`
    : `First join as @${handle}: ${hubCommand} join --handle ${shellQuote(handle)} -- ${shellQuote(`${handle}, coordinates ${plan.name}`)}. Confirm the returned handle is @${handle}; report a collision instead of dispatching under a different handle.`;
  const helpers = Object.entries(plan.agents).map(
    ([key, a]) =>
      `  ${key}: @${a.handle}, ${a.kind}${a.model ? ` / ${a.model}` : ' / harness default'}`,
  );
  return sanitizeForTerminal(`You are the lead for deployment "${plan.name}" in this Herdr workspace.
${membership}

Deployment file: ${path.resolve(file)}
Helpers:
${helpers.join('\n') || '  (none)'}

Coordinate helpers according to their purposes in that YAML file. Continue the user's assigned
task, or wait for one if none was assigned. Starting or reconciling a team does not assign work.
After posting messages, end your turn; replies arrive through the room. Do not poll or sleep.

Team changes: ${COMPOSE_SELF} up ${deployment}
Recorded state: ${COMPOSE_SELF} status
Stop managed helpers: ${COMPOSE_SELF} down ${deployment}
Your current harness, model and user-owned pane are preserved when up is called by an agent.

${plan.lead?.prompt ?? ''}`);
}

export function execLead(lead: LeadConfig, env = process.env): never {
  const hub = new Hub(env);
  if (!process.execve) {
    throw new Error('This Bun runtime cannot hand the shell to hub. Update Bun and retry.');
  }
  const inherited = Object.fromEntries(
    Object.entries(env).filter((entry) => entry[1] !== undefined),
  );
  return process.execve(
    hub.words[0] as string,
    [...hub.words, ...hub.startArgs({ ...lead, handle: 'lead' })],
    inherited,
  );
}
