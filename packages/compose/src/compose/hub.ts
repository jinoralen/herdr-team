// Hub integration crosses a subprocess seam, including when both tools run from source.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellQuote } from '@herdr/terminal';
import { z } from 'zod';
import type { ManagedAgent } from '#store';
import { RETRY_LATER_EXIT, RetryLater } from './retry.ts';

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

// The member is the helper's own join: the join or terminal compose recorded. Another member under
// its handle (after the helper left) is not.
export const isJoinOf = (member: Membership, helper: ManagedAgent): boolean =>
  member.joined_at === helper.joinedAt || member.terminal_id === helper.terminal;
// What compose reads from `status --json`. Hub and compose come from one build (ADR 0012), so
// output that doesn't parse means HERDR_TEAM_HUB_BIN points at another build.
const Snapshot = z.object({
  room: z.string(),
  members: z.array(Membership),
});

// Hub's stdout as JSON, or null when it isn't: the snapshot check below then names the hub.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Why compose refuses a hub's status --json, so the error says where to look.
function snapshotProblem(json: unknown, parsed: ReturnType<typeof Snapshot.safeParse>): string {
  if (json === null) {
    return 'printed no JSON for status --json';
  }
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'the top';
    return `returned a status this compose doesn't read (at ${field})`;
  }
  return `returned the status of room ${parsed.data.room}`;
}

// What up, down and status ask of hub. Hub (below) runs hub's command line; tests pass an
// in-memory one.
export type HubClient = Pick<
  Hub,
  'command' | 'check' | 'refresh' | 'members' | 'member' | 'memberByPane' | 'start'
>;

// Membership is read from hub's `status --json` once and then reused, so lookups don't each run a
// process. up and down call refresh() where hub's view may have moved on: on taking the deployment
// lock, and before reconciling (ticks may have run during seconds of Herdr calls). start() refreshes
// on its own, before and after, since it changes membership.
export class Hub {
  readonly words: string[];
  readonly command: string;
  private cached: Membership[] | null = null;
  constructor(private readonly env: NodeJS.ProcessEnv) {
    this.words = env.HERDR_TEAM_HUB_BIN
      ? [env.HERDR_TEAM_HUB_BIN]
      : words('herdr-hub', () => fileURLToPath(import.meta.resolve('@herdr/hub/cli')));
    this.command = this.words.map(shellQuote).join(' ');
  }
  private snapshot(): Membership[] {
    this.cached ??= this.read();
    return this.cached;
  }
  // The next lookup reads hub again.
  refresh(): void {
    this.cached = null;
  }
  private read(): Membership[] {
    const result = Bun.spawnSync([...this.words, 'status', '--json'], {
      env: this.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString().trim());
    }
    const json = parseJson(result.stdout.toString());
    const parsed = Snapshot.safeParse(json);
    if (!parsed.success || parsed.data.room !== this.env.HERDR_WORKSPACE_ID) {
      throw new Error(
        `Hub at ${this.command} ${snapshotProblem(json, parsed)}. Rebuild both, or fix HERDR_TEAM_HUB_BIN.`,
      );
    }
    return parsed.data.members;
  }
  check(): void {
    this.refresh();
    this.snapshot();
  }
  members(): Membership[] {
    return this.snapshot();
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
    agent: { definition: string; handle: string; prompt: string },
    pane: string,
  ): Promise<void> {
    this.refresh();
    const proc = Bun.spawn([...this.words, ...this.startArgs(agent), '--pane', pane], {
      env: this.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    // Other starts may run alongside this one: the next lookup reads hub after this start ended.
    this.refresh();
    if (code !== 0) {
      const message = stderr.trim() || stdout.trim();
      // Hub's own "retry later" stays one for compose's caller.
      throw code === RETRY_LATER_EXIT ? new RetryLater(message) : new Error(message);
    }
  }
  // invite starts the lead in the caller's own pane, and helpers with --pane in theirs. Kind,
  // model and description come from the definition.
  startArgs(agent: { definition: string; handle: string; prompt: string }): string[] {
    return ['invite', agent.definition, '--handle', agent.handle, '--prompt', agent.prompt];
  }
}
