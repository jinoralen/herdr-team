// Agent definitions: who an agent is (harness, model, the role peers see, its standing
// instructions), as Markdown files with frontmatter in the herdr-team folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeForTerminal } from '@herdr/terminal';
import { z } from 'zod';

// Only the keys herdr-team uses. Others (OpenCode's `permissions`, Claude Code's `tools`, …)
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
  // The file it was read from, absolute: what to pass to another process.
  file: string;
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

// The two kinds of file in the folder: definitions in agents/, compose teams in teams/.
const KINDS = {
  definition: {
    dir: 'agents',
    ext: ['.md'],
    what: 'agent definition',
    listed: 'Definitions',
    first: 'frontmatter with a description (and kind to start one), then its instructions',
  },
  team: {
    dir: 'teams',
    ext: ['.yaml', '.yml'],
    what: 'team',
    listed: 'Teams',
    first: 'a compose team',
  },
} as const;
type Kind = (typeof KINDS)[keyof typeof KINDS];

const isPath = (ref: string, kind: Kind): boolean =>
  ref.includes('/') || kind.ext.some((ext) => ref.endsWith(ext));

// A name is a file in the folder (agents/<name>.md, teams/<name>.yaml); a ref with a slash or the
// file's extension is a path from cwd, a definition's extension optional.
function locate(ref: string, kind: Kind, env: NodeJS.ProcessEnv, cwd: string): string {
  if (!isPath(ref, kind)) {
    const dir = path.join(teamDir(env), kind.dir);
    const names = kind.ext.map((ext) => path.join(dir, `${ref}${ext}`));
    const file = names.find((name) => fs.existsSync(name));
    if (!file) {
      throw missing(ref, kind, dir, names[0] as string);
    }
    return file;
  }
  const hasExt = kind.ext.some((ext) => ref.endsWith(ext));
  const file = path.resolve(cwd, hasExt || kind === KINDS.team ? ref : `${ref}${kind.ext[0]}`);
  if (!fs.existsSync(file)) {
    throw new Error(`No ${kind.what} file ${file}.`);
  }
  return file;
}

// The names of the files of one kind in dir, without their extension.
function namesIn(dir: string, kind: Kind): string[] {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .flatMap((name) => {
          const ext = kind.ext.find((e) => name.endsWith(e));
          return ext ? [name.slice(0, -ext.length)] : [];
        })
        .sort()
    : [];
}

// What to do when a name isn't there: the names that are, or how to write the first one.
function missing(ref: string, kind: Kind, dir: string, first: string): Error {
  const names = namesIn(dir, kind);
  const next = names.length
    ? `${kind.listed} there: ${names.join(', ')}.`
    : `Create ${first}: ${kind.first}.`;
  return new Error(`No ${kind.what} "${ref}" in ${dir}. ${next}`);
}

// The team file `up` uses when it is given no team: in the current folder only.
const DEFAULT_TEAM = 'herdr-team.yaml';

// A compose team file, by name or path; without one, herdr-team.yaml in cwd.
export function teamFile(
  ref: string | undefined,
  { env = process.env, cwd = process.cwd() }: Options = {},
): string {
  if (ref !== undefined) {
    return locate(ref, KINDS.team, env, cwd);
  }
  const file = path.join(cwd, DEFAULT_TEAM);
  if (fs.existsSync(file)) {
    return file;
  }
  const dir = path.join(teamDir(env), KINDS.team.dir);
  const names = namesIn(dir, KINDS.team);
  const named = names.length
    ? `${KINDS.team.listed} in ${dir}: ${names.join(', ')}; name one.`
    : `Name a team file, or add teams to ${dir}.`;
  throw new Error(`No ${DEFAULT_TEAM} in ${cwd}. ${named}`);
}

export function loadDefinition(
  ref: string,
  { env = process.env, cwd = process.cwd() }: Options = {},
): Definition {
  const file = locate(ref, KINDS.definition, env, cwd);
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
    file,
    handle,
    description: meta.description,
    ...(meta.kind && { kind: meta.kind }),
    ...(meta.model && { model: meta.model }),
    instructions: body.trim(),
  };
}
