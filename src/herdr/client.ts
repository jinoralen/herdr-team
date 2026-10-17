// Thin adapter over the installed `herdr` CLI. Only ticks use it. What it relies on from Herdr:
// docs/herdr.md.
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

function start(
  bin: string,
  args: string[],
  timeout: number,
  env: NodeJS.ProcessEnv,
): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
  try {
    // An argv array, never a shell: message text is passed as a single argv entry.
    return Bun.spawn([bin, ...args], {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout,
      killSignal: 'SIGKILL',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HerdrError('missing_binary', `Cannot run ${bin}; is Herdr installed?`);
    }
    throw error;
  }
}

// Why a herdr command failed: herdr's own error if it printed one, else what happened to the process.
function failure(args: string[], killed: boolean, stdout: string, stderr: string): HerdrError {
  const output = ErrorOutputSchema.safeParse(parseJson(stderr || stdout));
  if (output.success) {
    const { code, message } = output.data.error;
    return new HerdrError(code, message || code);
  }
  if (killed) {
    return new HerdrError('timeout', `herdr ${args.slice(0, 2).join(' ')} timed out`);
  }
  return new HerdrError('process_exit', (stderr || stdout).trim().slice(0, 500));
}

async function run(
  bin: string,
  args: string[],
  { timeout, env }: { timeout: number; env: NodeJS.ProcessEnv },
): Promise<unknown> {
  const proc = start(bin, args, timeout, env);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw failure(args, proc.killed, stdout, stderr);
  }
  const output = OutputSchema.safeParse(parseJson(stdout));
  if (!output.success) {
    throw new HerdrError('invalid_response', 'Herdr returned non-JSON output');
  }
  return output.data.result;
}

export function cliHerdr(env = process.env): Herdr {
  const bin = env.HERDR_BIN_PATH || 'herdr';
  return {
    async listAgents(): Promise<Agent[]> {
      const result = await run(bin, ['agent', 'list'], { timeout: 10000, env });
      const parsed = z.object({ agents: z.array(AgentSchema) }).safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'agent list has invalid agents data');
      }
      return parsed.data.agents;
    },
    async agent(paneId: string): Promise<Agent | null> {
      let result: unknown;
      try {
        result = await run(bin, ['agent', 'get', paneId], { timeout: 10000, env });
      } catch (caught) {
        if ((caught as HerdrError).code === 'agent_not_found') {
          return null;
        }
        throw caught;
      }
      const parsed = z.object({ agent: AgentSchema }).safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'agent get has invalid agent data');
      }
      return parsed.data.agent;
    },
    // Waits until the agent starts a turn (or stops at a question), so a delivery is confirmed
    // before the next one. Herdr reports agent_prompt_stalled if no turn starts within 5s.
    async prompt(paneId: string, text: string): Promise<void> {
      await run(
        bin,
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
        { timeout: 30000, env },
      );
    },
  };
}
