// Starts and enrolls a member in an existing shell pane, leaving pane ownership to the caller.
import { type Agent, cliHerdr } from '@herdr/herdr';
import { join, sanitizeForTerminal } from '#agent';
import { rootDir, Store } from '#store';
import { memberPrompt } from './prompt.ts';

function checkPane(pane: Agent | null, expected: Agent, kind: string): void {
  if (
    !pane ||
    pane.pane_id !== expected.pane_id ||
    pane.terminal_id !== expected.terminal_id ||
    pane.workspace_id !== expected.workspace_id ||
    pane.agent !== kind
  ) {
    throw new Error('The target pane changed during startup. Inspect it before retrying join.');
  }
}

export async function launchInPane({
  agent,
  handle,
  description,
  task,
  pane: target,
  env,
}: {
  agent: string;
  handle: string;
  description: string;
  task: string;
  pane: string;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  const herdr = cliHerdr(env);
  const pane = await herdr.pane(target);
  if (!pane || pane.pane_id !== target || !pane.workspace_id) {
    throw new Error(
      'The target pane does not exist or has no workspace. Choose an existing Herdr shell pane.',
    );
  }
  if (pane.agent) {
    throw new Error(
      'An agent is already running in the target pane. Choose an available shell pane.',
    );
  }
  const targetEnv = {
    ...env,
    HERDR_ENV: '1',
    HERDR_PANE_ID: target,
    HERDR_WORKSPACE_ID: pane.workspace_id,
  };
  description = sanitizeForTerminal(description).trim();
  // Reserve the exact handle before starting anything. A startup tick can reject this shell join;
  // the second join below recovers it after detection, with the same collision checks.
  join({ description, handle, env: targetEnv });
  try {
    const started = await herdr.startAgent({ kind: agent, paneId: target });
    // Start responses may omit workspace metadata; the live pane must still match the target.
    checkPane({ ...started, workspace_id: started.workspace_id ?? pane.workspace_id }, pane, agent);
    const live = await herdr.pane(target);
    checkPane(live, pane, agent);
    const store = new Store(rootDir(targetEnv), pane.workspace_id);
    const joined = store.transaction(() => {
      const instructions = join({ description, handle, env: targetEnv });
      const member = store.member(handle);
      if (!member || member.pane_id !== target) {
        throw new Error(
          'The target membership changed during startup. Inspect it before retrying join.',
        );
      }
      const bound = { terminal_id: pane.terminal_id, agent };
      if (
        store
          .members('active')
          .some((m) => m.handle !== handle && m.terminal_id === pane.terminal_id)
      ) {
        throw new Error(
          'The target terminal already has another membership. Inspect it before retrying join.',
        );
      }
      const confirmed =
        member.status === 'pending' ? store.admit(member, bound) : store.rebind(member, bound);
      if (!confirmed) {
        throw new Error(
          'The target membership could not be confirmed. Inspect it before retrying join.',
        );
      }
      return { prompt: memberPrompt(`${instructions}\n\nYour role: ${description}`, task), member };
    });
    await herdr.prompt(target, joined.prompt);
    if (!store.current(joined.member)) {
      throw new Error(
        'The target membership changed while submitting the guide. Inspect it before retrying join.',
      );
    }
    return `Started ${agent} as @${handle} in ${target} (room ${pane.workspace_id}); membership confirmed and guide submitted.`;
  } catch (error) {
    throw new Error(
      `Startup of @${handle} in ${target} did not complete: ${(error as Error).message} The agent or guide may already be present. Inspect the pane and room status before retrying; nothing was retried automatically.`,
    );
  }
}
