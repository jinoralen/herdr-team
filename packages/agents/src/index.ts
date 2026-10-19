// Agent definitions: who an agent is (harness, model, the role peers see, its standing
// instructions), as Markdown files with frontmatter in the herdr-team folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeForTerminal } from '@herdr/terminal';
import { z } from 'zod';

// Only the keys herdr-agent-hub uses. Others (OpenCode's `permissions`, Claude Code's `tools`, …)
// are dropped, so files written for other tools load as they are.
const Frontmatter = z.object({
  description: z
    .string({ error: 'add a description: the short role shown to the other members' })
    .trim()
    .min(1, 'add a description: the short role shown to the other members')
    .max(200, 'the description is over 200 chars; keep it to a short role'),
  kind: z.enum(['codex', 'claude', 'pi'], { error: 'kind must be codex, claude or pi' }).optional(),
  model: z
    .string()
    .refine(
      (model) =>
        model.length > 0 &&
        !model.startsWith('-') &&
        !/\s/u.test(model) &&
        sanitizeForTerminal(model) === model,
      'model must be a nonempty id without a leading hyphen, spaces or control characters',
    )
    .optional(),
  handle: z.string().optional(),
});

// The room's handle grammar; checked here too because a handle can come from the file name.
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,19}$/;

export type Definition = {
  handle: string;
  description: string;
  kind?: 'codex' | 'claude' | 'pi';
  model?: string;
  instructions: string;
};

type Options = { env?: NodeJS.ProcessEnv; cwd?: string };

// The herdr-team folder: definitions in agents/, compose teams in teams/. Plain files, so agents
// can read them inside their sandboxes without asking Herdr.
function teamDir(env: NodeJS.ProcessEnv): string {
  if (env.HERDR_TEAM_DIR) {
    return env.HERDR_TEAM_DIR;
  }
  const config = env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), '.config');
  return path.join(config, 'herdr-team');
}

// A name is a file in the folder's agents/; anything with a slash or ending in .md is a path.
function definitionFile(ref: string, env: NodeJS.ProcessEnv, cwd: string): string {
  if (!ref.includes('/') && !ref.endsWith('.md')) {
    return path.join(teamDir(env), 'agents', `${ref}.md`);
  }
  return path.resolve(cwd, ref.endsWith('.md') ? ref : `${ref}.md`);
}

// What to do when a definition isn't there: the names that are, or how to write the first one.
function missing(ref: string, file: string): Error {
  if (ref.includes('/') || ref.endsWith('.md')) {
    return new Error(`No agent definition file ${file}.`);
  }
  const dir = path.dirname(file);
  const names = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => name.slice(0, -3))
        .sort()
    : [];
  const next = names.length
    ? `Definitions there: ${names.join(', ')}.`
    : `Create ${file}: frontmatter with a description (and kind to start one), then its instructions.`;
  return new Error(`No agent definition "${ref}" in ${dir}. ${next}`);
}

export function loadDefinition(
  ref: string,
  { env = process.env, cwd = process.cwd() }: Options = {},
): Definition {
  const file = definitionFile(ref, env, cwd);
  if (!fs.existsSync(file)) {
    throw missing(ref, file);
  }
  const fail = (problem: string): Error => new Error(`Agent definition ${file}: ${problem}.`);
  // Files saved on Windows (or by editors set to CRLF) parse the same.
  const text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!parts) {
    throw fail('it must start with frontmatter between --- lines, then the instructions');
  }
  const [, head = '', body = ''] = parts;
  const parsed = Frontmatter.safeParse(Bun.YAML.parse(head) ?? {});
  if (!parsed.success) {
    throw fail(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const meta = parsed.data;
  const handle = meta.handle ?? path.basename(file, '.md');
  if (!HANDLE.test(handle)) {
    throw fail(
      `handle @${handle} must be 1–20 lowercase letters, digits, underscores or hyphens, starting with a letter or digit (set handle:, or rename the file)`,
    );
  }
  return {
    handle,
    description: meta.description,
    ...(meta.kind && { kind: meta.kind }),
    ...(meta.model && { model: meta.model }),
    instructions: body.trim(),
  };
}
