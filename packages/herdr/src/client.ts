// Thin adapter over the installed `herdr` CLI, used by ticks and agent startup. Herdr's guarantees:
// docs/herdr.md.
import { type Exec, type Exited, spawnExec } from '@herdr/terminal';
import { z } from 'zod';
import { type Agent, AgentSchema, type Herdr } from './types.ts';

export class HerdrError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// What herdr prints when a command fails, on stderr (or stdout).
const ErrorOutputSchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});
// What herdr prints when a command succeeds; each caller validates its own `result`.
const OutputSchema = z.object({ result: z.unknown() });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Why a herdr command failed: herdr's own error if it printed one, else what happened to the process.
function failure(args: string[], { timedOut, stdout, stderr }: Exited): HerdrError {
  const output = ErrorOutputSchema.safeParse(parseJson(stderr || stdout));
  if (output.success) {
    const { code, message } = output.data.error;
    return new HerdrError(code, message || code);
  }
  if (timedOut) {
    return new HerdrError('timeout', `herdr ${args.slice(0, 2).join(' ')} timed out`);
  }
  return new HerdrError('process_exit', (stderr || stdout).trim().slice(0, 500));
}

// Runs one herdr command and returns its `result`, which each caller validates.
export function herdrCommand(
  env: NodeJS.ProcessEnv,
  exec: Exec,
): (args: string[], timeout: number) => Promise<unknown> {
  const bin = env.HERDR_BIN_PATH || 'herdr';
  return async (args: string[], timeout: number): Promise<unknown> => {
    let exited: Exited;
    try {
      exited = await exec([bin, ...args], { env, timeout });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HerdrError('missing_binary', `Cannot run ${bin}; is Herdr installed?`);
      }
      throw error;
    }
    if (exited.exitCode !== 0) {
      throw failure(args, exited);
    }
    const output = OutputSchema.safeParse(parseJson(exited.stdout));
    if (!output.success) {
      throw new HerdrError('invalid_response', 'Herdr returned non-JSON output');
    }
    return output.data.result;
  };
}

// The agent's name in Herdr's sidebar. Names must be unique among live agents in all workspaces;
// Herdr never reuses a pane ID, so the pane makes it so. Names are lowercase letters, digits, - and
// _, start with a letter and fit 32 characters, while IDs mix cases (w2N:p3 becomes w2_n-p3).
function agentName(label: string, paneId: string): string {
  const pane = paneId.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/[^a-z0-9_]/g, '-');
  const base = /^[a-z]/.test(label) ? label : `agent-${label}`;
  return `${base.slice(0, 31 - pane.length)}-${pane}`;
}

export function cliHerdr(env = process.env, exec: Exec = spawnExec): Herdr {
  const run = herdrCommand(env, exec);
  return {
    async startAgent({
      label,
      kind,
      paneId,
      args = [],
    }: {
      label: string;
      kind: string;
      paneId: string;
      args?: string[];
    }): Promise<Agent> {
      const result = await run(
        [
          'agent',
          'start',
          agentName(label, paneId),
          '--kind',
          kind,
          '--pane',
          paneId,
          '--timeout',
          '120000',
          ...(args.length ? ['--', ...args] : []),
        ],
        130000,
      );
      const parsed = z.object({ agent: AgentSchema }).safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'agent start has invalid agent data');
      }
      return parsed.data.agent;
    },
    async listPanes(): Promise<Agent[]> {
      const result = await run(['pane', 'list'], 10000);
      const parsed = z.object({ panes: z.array(AgentSchema) }).safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'pane list has invalid panes data');
      }
      return parsed.data.panes;
    },
    async pane(paneId: string): Promise<Agent | null> {
      let result: unknown;
      try {
        result = await run(['pane', 'get', paneId], 10000);
      } catch (caught) {
        if ((caught as HerdrError).code === 'pane_not_found') {
          return null;
        }
        throw caught;
      }
      const parsed = z.object({ pane: AgentSchema }).safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'pane get has invalid pane data');
      }
      return parsed.data.pane;
    },
    // Waits until the agent starts a turn (or stops at a question), so a delivery is confirmed
    // before the next one. Herdr reports agent_prompt_stalled if no turn starts within 5s.
    async prompt(paneId: string, text: string): Promise<void> {
      await run(
        [
          'agent',
          'prompt',
          paneId,
          text,
          '--wait',
          '--until',
          'working',
          '--until',
          'blocked',
          '--timeout',
          '20000',
        ],
        30000,
      );
    },
  };
}
