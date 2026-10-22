// `invite`: starts and enrolls a member in an existing shell pane, leaving pane ownership to the
// caller. A pane where an agent already runs is never typed into: the caller gets the line to paste.
import { type Agent, cliHerdr, type Herdr, HerdrError } from '@herdr/herdr';
import { join } from '#agent';
import { rootDir, Store } from '#store';
import { memberPrompt } from './prompt.ts';
import { prepareStart, refuseRunningAgent, type Start } from './start.ts';

// Who was started where. The text is what a user reads; --json prints the rest.
export type Invited = { agent: string; handle: string; pane: string; room: string; text: string };

// Startup began and didn't finish: the agent or its guide may already be there, so the caller
// must look before retrying (ADR 0006).
export class UncertainStartup extends Error {}

export function invite({
  pane,
  as,
  prompt,
  env = process.env,
  ...given
}: Partial<Start> & {
  pane: string;
  as?: string;
  prompt?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<Invited> {
  return launchInPane({ ...prepareStart(given, as, prompt, env), as, pane, env });
}

function checkPane(pane: Agent | null, expected: Agent, kind: string): void {
  if (
    !pane ||
    pane.pane_id !== expected.pane_id ||
    pane.terminal_id !== expected.terminal_id ||
    pane.workspace_id !== expected.workspace_id ||
    pane.agent !== kind
  ) {
    throw new Error('The target pane changed during startup. Inspect it before retrying invite.');
  }
}

// A pane just created (compose's) may not have reached its shell prompt yet, and Herdr refuses to
// start an agent there. The refusal types nothing, so starting again is safe.
const SHELL_READY_MS = 10_000;
const SHELL_POLL_MS = 250;

async function startWhenShellReady(
  herdr: Herdr,
  options: Parameters<Herdr['startAgent']>[0],
): Promise<Agent> {
  const deadline = Date.now() + SHELL_READY_MS;
  for (;;) {
    try {
      return await herdr.startAgent(options);
    } catch (error) {
      if (
        !(error instanceof HerdrError && error.code === 'agent_pane_busy') ||
        Date.now() > deadline
      ) {
        throw error;
      }
      await Bun.sleep(SHELL_POLL_MS);
    }
  }
}

async function launchInPane({
  agent,
  as,
  model,
  handle,
  description,
  task,
  pane: target,
  env,
}: {
  agent: string;
  as?: string;
  model?: string;
  handle: string;
  description: string;
  task: string;
  pane: string;
  env: NodeJS.ProcessEnv;
}): Promise<Invited> {
  const herdr = cliHerdr(env);
  const pane = await herdr.pane(target);
  if (!pane || pane.pane_id !== target || !pane.workspace_id) {
    throw new Error(
      'The target pane does not exist or has no workspace. Choose an existing Herdr shell pane.',
    );
  }
  refuseRunningAgent(pane.agent, target, { as, handle, description }, 'or invite a shell pane.');
  const targetEnv = {
    ...env,
    HERDR_ENV: '1',
    HERDR_PANE_ID: target,
    HERDR_WORKSPACE_ID: pane.workspace_id,
  };
  // Reserve the exact handle before starting anything. A startup tick can reject this shell join;
  // the second join below recovers it after detection, with the same collision checks.
  const store = new Store(rootDir(targetEnv), pane.workspace_id);
  const prompt = store.transaction(() => {
    const instructions = join({ as, description, handle, env: targetEnv });
    return memberPrompt(`${instructions}\n\nYour role: ${description}`, task);
  });
  try {
    const started = await startWhenShellReady(herdr, {
      kind: agent,
      paneId: target,
      args: model ? ['--model', model] : [],
    });
    // Start responses may omit workspace metadata; the live pane must still match the target.
    checkPane({ ...started, workspace_id: started.workspace_id ?? pane.workspace_id }, pane, agent);
    const live = await herdr.pane(target);
    checkPane(live, pane, agent);
    const joined = store.transaction(() => {
      join({ as, description, handle, env: targetEnv });
      const member = store.member(handle);
      if (!member || member.pane_id !== target) {
        throw new Error(
          'The target membership changed during startup. Inspect it before retrying invite.',
        );
      }
      const bound = { terminal_id: pane.terminal_id, agent };
      if (
        store
          .members('active')
          .some((m) => m.handle !== handle && m.terminal_id === pane.terminal_id)
      ) {
        throw new Error(
          'The target terminal already has another membership. Inspect it before retrying invite.',
        );
      }
      const confirmed =
        member.status === 'pending' ? store.admit(member, bound) : store.rebind(member, bound);
      if (!confirmed) {
        throw new Error(
          'The target membership could not be confirmed. Inspect it before retrying invite.',
        );
      }
      return { member };
    });
    await herdr.prompt(target, prompt);
    if (!store.current(joined.member)) {
      throw new Error(
        'The target membership changed while submitting the guide. Inspect it before retrying invite.',
      );
    }
    const room = pane.workspace_id;
    return {
      agent,
      handle,
      pane: target,
      room,
      text: `Started ${agent} as @${handle} in ${target} (room ${room}); membership confirmed and guide submitted.`,
    };
  } catch (error) {
    throw new UncertainStartup(
      `Startup of @${handle} in ${target} did not complete: ${(error as Error).message} The agent or guide may already be present. Inspect the pane and room status before retrying; nothing was retried automatically.`,
    );
  }
}
