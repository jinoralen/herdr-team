// Hub integration crosses a subprocess seam, including when both tools run from source.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellQuote } from '@herdr/terminal';
import { z } from 'zod';

function words(name: string, source: () => string): string[] {
  if (Bun.main.startsWith('/$bunfs/')) {
    return [path.join(path.dirname(process.execPath), name)];
  }
  return [process.execPath, source()];
}
export const COMPOSE_SELF = words('herdr-compose', () =>
  fileURLToPath(import.meta.resolve('./main.ts')),
)
  .map(shellQuote)
  .join(' ');

const Membership = z.object({
  handle: z.string(),
  pane_id: z.string(),
  joined_at: z.string(),
  status: z.enum(['pending', 'active', 'left', 'gone', 'rejected']),
  terminal_id: z.string().nullable(),
  agent: z.string().nullable(),
  queuedFrom: z.boolean(),
});
export type Membership = z.infer<typeof Membership>;
const Snapshot = z.object({ room: z.string(), members: z.array(Membership) });

export class Hub {
  readonly words: string[];
  readonly command: string;
  constructor(private readonly env: NodeJS.ProcessEnv) {
    this.words = env.HERDR_AGENT_HUB_BIN
      ? [env.HERDR_AGENT_HUB_BIN]
      : words('herdr-agent-hub', () => fileURLToPath(import.meta.resolve('@herdr/hub/cli')));
    this.command = this.words.map(shellQuote).join(' ');
  }
  private snapshot(): Membership[] {
    const result = Bun.spawnSync([...this.words, 'status', '--json'], {
      env: this.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString().trim());
    }
    const parsed = Snapshot.safeParse(JSON.parse(result.stdout.toString()));
    if (!parsed.success || parsed.data.room !== this.env.HERDR_WORKSPACE_ID) {
      throw new Error('Hub returned an invalid membership snapshot. Rebuild hub and retry.');
    }
    return parsed.data.members;
  }
  check(): void {
    this.snapshot();
  }
  member(handle: string): Membership | null {
    return this.snapshot().find((m) => m.handle === handle) ?? null;
  }
  memberByPane(pane: string): Membership | null {
    return (
      this.snapshot().find((m) => m.pane_id === pane && ['pending', 'active'].includes(m.status)) ??
      null
    );
  }
  async start(
    agent: { kind: string; model?: string; handle: string; prompt: string },
    pane: string,
  ): Promise<void> {
    const proc = Bun.spawn([...this.words, 'invite', pane, ...this.agentArgs(agent)], {
      env: this.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new Error(stderr.trim() || stdout.trim());
    }
  }
  // Starts the lead in the caller's own pane; helpers go to their panes through invite.
  startArgs(agent: { kind: string; model?: string; handle: string; prompt: string }): string[] {
    return ['join', ...this.agentArgs(agent)];
  }
  private agentArgs(agent: {
    kind: string;
    model?: string;
    handle: string;
    prompt: string;
  }): string[] {
    return [
      '--agent',
      agent.kind,
      '--handle',
      agent.handle,
      '--description',
      `${agent.handle}, ${agent.kind}`,
      '--prompt',
      agent.prompt,
      ...(agent.model ? ['--model', agent.model] : []),
    ];
  }
}
