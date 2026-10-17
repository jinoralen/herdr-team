// A team's desired agents and simple tab layout. Resolve file context before changing any panes.
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeForTerminal } from '@herdr/terminal';
import { z } from 'zod';

// Keys double as default handles and must fit the room's handle grammar.
const Key = z.string().regex(/^[a-z][a-z0-9_-]{0,19}$/);
const Shared = z.strictObject({
  prompt: z.string().default(''),
  files: z.array(z.string()).default([]),
});
const Model = z
  .string()
  .refine(
    (model) =>
      model.length > 0 &&
      !model.startsWith('-') &&
      !/\s/u.test(model) &&
      sanitizeForTerminal(model) === model,
    'Use a nonempty model identifier without a leading hyphen, spaces or control characters.',
  );
const Lead = z.strictObject({
  kind: z.enum(['codex', 'claude', 'pi']),
  model: Model.optional(),
  prompt: z.string().default(''),
});
export type LeadConfig = z.infer<typeof Lead>;
const Agent = z.strictObject({
  kind: z.enum(['codex', 'claude', 'pi']),
  model: Model.optional(),
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

export async function deploymentName(file: string): Promise<string> {
  const raw = Bun.YAML.parse(await Bun.file(file).text());
  const parsed = z.object({ name: Key }).safeParse(raw);
  if (!parsed.success) {
    throw new Error('The YAML file needs a valid deployment name.');
  }
  return parsed.data.name;
}
export async function loadPlan(file: string, leadHandle = 'lead'): Promise<ManifestPlan> {
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
    const cwd = path.resolve(base, a.cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`Working directory ${cwd} is missing or is not a directory.`);
    }
    const fingerprint = new Bun.CryptoHasher('sha256')
      .update(
        JSON.stringify(
          [a.kind, handle, cwd, prompt, a.model].filter((value) => value !== undefined),
        ),
      )
      .digest('hex');
    agents[key] = { kind: a.kind, model: a.model, handle, cwd, prompt, tab: a.tab, fingerprint };
  }
  return { name: config.name, lead: config.lead, tabs: config.tabs, agents };
}
