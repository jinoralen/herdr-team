// A team's desired agents and simple tab layout. Resolve file context before changing any panes.
import fs from 'node:fs';
import path from 'node:path';
import { type Definition, loadDefinition, teamFile } from '@herdr/agents';
import { sanitizeForTerminal } from '@herdr/terminal';
import { z } from 'zod';

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
// The lead as hub starts it: its definition's file and kind, and this team's task.
export type LeadConfig = { definition: string; kind: string; prompt: string };
const Agent = z.strictObject({
  use: Use,
  handle: Key.optional(),
  tab: Key,
  cwd: z.string().default('.'),
  prompt: z.string().default(''),
});
const Manifest = z.strictObject({
  name: Key,
  lead: Lead.optional(),
  shared: Shared.default({ prompt: '', files: [] }),
  tabs: z.record(Key, z.strictObject({ layout: z.enum(['rows', 'columns']).default('columns') })),
  agents: z.record(Key, Agent),
});
export type DesiredAgent = {
  // The definition's file, passed to hub's invite --as.
  definition: string;
  kind: string;
  model?: string;
  handle: string;
  cwd: string;
  prompt: string;
  tab: string;
  fingerprint: string;
};
export type ManifestPlan = {
  name: string;
  lead?: LeadConfig;
  tabs: Record<string, { layout: 'rows' | 'columns' }>;
  agents: Record<string, DesiredAgent>;
};

// A team by name (teams/<name>.yaml in the herdr-team folder) or path.
export function resolveTeam(ref: string, env: NodeJS.ProcessEnv = process.env): string {
  return teamFile(ref, { env });
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
export async function loadPlan(
  file: string,
  leadHandle = 'lead',
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManifestPlan> {
  const parsed = Manifest.safeParse(Bun.YAML.parse(await Bun.file(file).text()));
  if (!parsed.success) {
    throw new Error(`Invalid team YAML: ${parsed.error.message}`);
  }
  const config = parsed.data;
  const base = path.dirname(path.resolve(file));
  const context = await Promise.all(
    config.shared.files.map(async (f) => {
      const absolute = path.resolve(base, f);
      return `File ${absolute}:\n${await Bun.file(absolute).text()}`;
    }),
  );
  const agents: Record<string, DesiredAgent> = {};
  const handles = new Set<string>();
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
    const prompt = sanitizeForTerminal(
      [
        `Your coordinating lead is @${leadHandle}. Address reports to this handle.`,
        config.shared.prompt,
        ...context,
        a.prompt,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    agents[key] = desiredAgent({
      definition,
      handle,
      cwd: path.resolve(base, a.cwd),
      prompt,
      tab: a.tab,
    });
  }
  return { name: config.name, lead: leadConfig(config.lead, base, env), tabs: config.tabs, agents };
}

function leadConfig(
  lead: z.infer<typeof Lead> | undefined,
  base: string,
  env: NodeJS.ProcessEnv,
): LeadConfig | undefined {
  if (!lead) {
    return undefined;
  }
  const { file, kind } = startable(lead.use, base, env, 'The lead');
  return { definition: file, kind, prompt: lead.prompt };
}

// One helper as compose keeps it. The definition's contents are in the fingerprint, so editing it
// replaces the helper like a prompt change.
function desiredAgent({
  definition,
  handle,
  cwd,
  prompt,
  tab,
}: {
  definition: Definition & { kind: string };
  handle: string;
  cwd: string;
  prompt: string;
  tab: string;
}): DesiredAgent {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Working directory ${cwd} is missing or is not a directory.`);
  }
  const { kind, model, description, instructions } = definition;
  const fingerprint = new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify(
        [kind, handle, cwd, prompt, model, description, instructions].filter(
          (value) => value !== undefined,
        ),
      ),
    )
    .digest('hex');
  return { definition: definition.file, kind, model, handle, cwd, prompt, tab, fingerprint };
}
