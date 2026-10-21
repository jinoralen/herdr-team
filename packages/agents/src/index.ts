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
    // Read from whichever folder a command runs in: a relative path would name a different one each time.
    if (!path.isAbsolute(env.HERDR_TEAM_DIR)) {
      throw new Error('HERDR_TEAM_DIR must be an absolute path.');
    }
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
// file's extension is a path from cwd, a definition's extension optional. The files it may be.
function candidates(ref: string, kind: Kind, env: NodeJS.ProcessEnv, cwd: string): string[] {
  if (!isPath(ref, kind)) {
    const dir = path.join(teamDir(env), kind.dir);
    return kind.ext.map((ext) => path.join(dir, `${ref}${ext}`));
  }
  const hasExt = kind.ext.some((ext) => ref.endsWith(ext));
  return [path.resolve(cwd, hasExt || kind === KINDS.team ? ref : `${ref}${kind.ext[0]}`)];
}

function locate(ref: string, kind: Kind, env: NodeJS.ProcessEnv, cwd: string): string {
  const files = candidates(ref, kind, env, cwd);
  const file = files.find((name) => fs.existsSync(name));
  if (file) {
    return file;
  }
  if (isPath(ref, kind)) {
    throw new Error(`No ${kind.what} file ${files[0]}.`);
  }
  throw missing(ref, kind, path.dirname(files[0] as string), files[0] as string);
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

// The file a definition ref names, or null when there is none (it may still fail to load). Throws
// when the folder can't be read, so an unreadable folder isn't taken for an empty one.
export function definitionFile(
  ref: string,
  { env = process.env, cwd = process.cwd() }: Options = {},
): string | null {
  for (const file of candidates(ref, KINDS.definition, env, cwd)) {
    try {
      fs.statSync(file);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return null;
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

// One file in the folder, and what reading it found: problem says why it can't be used.
export type Listed<T> = { name: string; file: string; value?: T; problem?: string };

// Every definition in agents/, each read as join and invite would read it.
export function listDefinitions({ env = process.env }: Options = {}): {
  dir: string;
  definitions: Listed<Definition>[];
} {
  const dir = path.join(teamDir(env), KINDS.definition.dir);
  const definitions = namesIn(dir, KINDS.definition).map((name) => {
    const file = path.join(dir, `${name}.md`);
    try {
      return { name, file, value: loadDefinition(file, { env }) };
    } catch (error) {
      return { name, file, problem: (error as Error).message };
    }
  });
  return { dir, definitions };
}

// The team files in teams/, by name; reading them is compose's.
export function listTeams({ env = process.env }: Options = {}): {
  dir: string;
  teams: { name: string; file: string }[];
} {
  const dir = path.join(teamDir(env), KINDS.team.dir);
  const teams = namesIn(dir, KINDS.team).map((name) => ({
    name,
    file: locate(name, KINDS.team, env, dir),
  }));
  return { dir, teams };
}
