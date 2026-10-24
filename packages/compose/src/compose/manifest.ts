// A team's desired agents and simple tab layout. Resolve file context before changing any panes.
import fs from 'node:fs';
import path from 'node:path';
import { type Definition, loadDefinition, teamFile } from '@herdr/agents';
import { sanitizeForTerminal } from '@herdr/terminal';
import { z } from 'zod';
import { coordinatorPrompt } from './lead.ts';

// Keys double as default handles and must fit the room's handle grammar.
const Key = z.string().regex(/^[a-z][a-z0-9_-]{0,19}$/);
const Shared = z.strictObject({
  prompt: z.string().default(''),
  files: z.array(z.string()).default([]),
});
// Who an agent is lives in its definition (name, or path relative to the team file); the team adds
// where it runs and this team's task.
const Use = z.string().min(1);
const Lead = z.strictObject({
  use: Use,
  prompt: z.string().default(''),
});
const Agent = z.strictObject({
  use: Use,
  handle: Key.optional(),
  tab: Key,
  cwd: z.string().default('.'),
  prompt: z.string().default(''),
});
const Manifest = z.strictObject({
  name: Key,
  lead: Lead,
  shared: Shared.default({ prompt: '', files: [] }),
  tabs: z.record(Key, z.strictObject({ layout: z.enum(['rows', 'columns']).default('columns') })),
  agents: z.record(Key, Agent),
});
export type DesiredAgent = {
  // The definition's file, passed to hub's invite.
  definition: string;
  kind: string;
  model?: string;
  handle: string;
  cwd: string;
  prompt: string;
  tab: string;
  fingerprint: string;
  // What the fingerprint is made of, each hashed, so a replacement can say what changed.
  parts: Parts;
};
export type Parts = Record<'definition' | 'handle' | 'cwd' | 'purpose' | 'context', string>;
export type ManifestPlan = {
  name: string;
  tabs: Record<string, { layout: 'rows' | 'columns' }>;
  agents: Record<string, DesiredAgent>;
};

// A team by name (teams/<name>.yaml in the herdr-team folder) or path; without one,
// herdr-team.yaml in the current folder.
export function resolveTeam(
  ref: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return teamFile(ref, { env, cwd });
}

// A definition that can start an agent: it has a kind.
function startable(
  use: string,
  base: string,
  env: NodeJS.ProcessEnv,
  who: string,
): Definition & { kind: string } {
  const definition = loadDefinition(use, { env, cwd: base });
  if (!definition.kind) {
    throw new Error(
      `${who} uses ${definition.file}, which has no kind. Add kind: codex, claude or pi to it.`,
    );
  }
  return { ...definition, kind: definition.kind };
}

export async function deploymentName(file: string): Promise<string> {
  const raw = Bun.YAML.parse(await Bun.file(file).text());
  const parsed = z.object({ name: Key }).safeParse(raw);
  if (!parsed.success) {
    throw new Error('The YAML file needs a valid deployment name.');
  }
  return parsed.data.name;
}
// workdir: the folder up runs in, where the team works: the lead runs there, and agents' cwd and
// shared files resolve from it. use paths resolve from the team file, since definitions travel
// with it.
export async function loadPlan(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  workdir: string = process.cwd(),
): Promise<ManifestPlan> {
  const parsed = Manifest.safeParse(Bun.YAML.parse(await Bun.file(file).text()));
  if (!parsed.success) {
    throw new Error(`Invalid team YAML: ${parsed.error.message}`);
  }
  const config = parsed.data;
  const base = path.dirname(path.resolve(file));
  const context = await Promise.all(
    config.shared.files.map(async (f) => {
      const absolute = path.resolve(workdir, f);
      return `File ${absolute}:\n${await Bun.file(absolute).text()}`;
    }),
  );
  const agents: Record<string, DesiredAgent> = {};
  const handles = new Set<string>(['lead']);
  for (const [key, a] of Object.entries(config.agents)) {
    if (!Object.hasOwn(config.tabs, a.tab)) {
      throw new Error(`Agent ${key} names unknown tab ${a.tab}.`);
    }
    const definition = startable(a.use, base, env, `Agent ${key}`);
    const handle = a.handle ?? key;
    if (handles.has(handle)) {
      throw new Error(`Handle @${handle} is used by more than one agent.`);
    }
    handles.add(handle);
    const shared = [
      'Your coordinating lead is @lead. Address reports to this handle.',
      config.shared.prompt,
      ...context,
    ];
    agents[key] = desiredAgent({
      definition,
      handle,
      cwd: path.resolve(workdir, a.cwd),
      shared,
      purpose: a.prompt,
      tab: a.tab,
    });
  }
  agents.$lead = desiredAgent({
    definition: startable(config.lead.use, base, env, 'The lead'),
    handle: 'lead',
    cwd: path.resolve(workdir),
    shared: [],
    purpose: coordinatorPrompt(config.name, file, agents, config.lead.prompt),
    tab: '$lead',
  });
  // $ cannot occur in user keys; the lead uses the ordinary managed-agent lifecycle.
  return { name: config.name, tabs: { ...config.tabs, $lead: { layout: 'columns' } }, agents };
}

// One helper as compose keeps it. The definition's contents are in the fingerprint, so editing it
// replaces the helper like a prompt change.
function desiredAgent({
  definition,
  handle,
  cwd,
  shared,
  purpose,
  tab,
}: {
  definition: Definition & { kind: string };
  handle: string;
  cwd: string;
  // The lead's handle and the team's shared prompt and files, then this agent's own task.
  shared: (string | undefined)[];
  purpose: string | undefined;
  tab: string;
}): DesiredAgent {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Working directory ${cwd} is missing or is not a directory.`);
  }
  const prompt = sanitizeForTerminal([...shared, purpose].filter(Boolean).join('\n\n'));
  const { kind, model, description, instructions } = definition;
  const fingerprint = hash([kind, handle, cwd, prompt, model, description, instructions]);
  const parts = {
    definition: hash([kind, model, description, instructions]),
    handle,
    cwd,
    purpose: hash([purpose]),
    context: hash(shared),
  };
  return { definition: definition.file, kind, model, handle, cwd, prompt, tab, fingerprint, parts };
}

function hash(values: unknown[]): string {
  return new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(values.filter((value) => value !== undefined)))
    .digest('hex');
}
