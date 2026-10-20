// `__complete`: the values only this program knows, for the zsh completion in shell/zsh/. One
// "value<TAB>description" per line. It runs on every Tab press, so it only reads, never creates
// the database, and prints nothing rather than failing.
import fs from 'node:fs';
import { listDefinitions } from '@herdr/agents';
import { sanitizeForTerminal } from '@herdr/terminal';
import { dbPath, rootDir, Store } from '#store';

// What `__complete <what>` can list.
const SOURCES = {
  // join and invite's [agent]: the definitions that load.
  definitions: (env: NodeJS.ProcessEnv): [string, string][] =>
    listDefinitions({ env }).definitions.flatMap(({ name, value }) =>
      value ? [[name, value.description]] : [],
    ),
  // message --to: the other active members of this pane's room; none outside a Herdr pane.
  handles: (env: NodeJS.ProcessEnv): [string, string][] => {
    if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
      return [];
    }
    const root = rootDir(env);
    if (!fs.existsSync(dbPath(root))) {
      return [];
    }
    return new Store(root, env.HERDR_WORKSPACE_ID)
      .members('active')
      .filter((m) => m.pane_id !== env.HERDR_PANE_ID)
      .map((m) => [m.handle, m.description]);
  },
};

export function complete(
  what: string,
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {},
): string {
  if (!Object.hasOwn(SOURCES, what)) {
    return '';
  }
  try {
    return SOURCES[what as keyof typeof SOURCES](env)
      .map((pair) => pair.map((word) => sanitizeForTerminal(word).replace(/\s+/g, ' ')).join('\t'))
      .join('\n');
  } catch {
    return '';
  }
}
