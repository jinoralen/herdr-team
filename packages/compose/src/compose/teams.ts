// `teams`: the team files up can use by name, each read as up would read it, and what is wrong
// with any that can't be used. No Herdr and no hub: it only reads files.
import { listTeams } from '@herdr/agents';
import { sanitizeForTerminal } from '@herdr/terminal';
import { COMPOSE_SELF } from './hub.ts';
import { loadPlan } from './manifest.ts';

export async function teams({
  env = process.env,
  json = false,
}: {
  env?: NodeJS.ProcessEnv;
  json?: boolean;
} = {}): Promise<string> {
  const { dir, teams: files } = listTeams({ env });
  const read = await Promise.all(
    files.map(async ({ name, file }) => {
      try {
        // The lead's handle only goes into helpers' prompts; any one reads the team the same.
        const plan = await loadPlan(file, 'lead', env);
        return { name, file, deployment: plan.name, agents: Object.keys(plan.agents) };
      } catch (error) {
        return { name, file, problem: (error as Error).message };
      }
    }),
  );
  if (json) {
    return JSON.stringify({ dir, teams: read });
  }
  if (!read.length) {
    return `No teams in ${dir}. Add <name>.yaml there, or run ${COMPOSE_SELF} up <team file>.`;
  }
  const lines = read.map((t) =>
    'problem' in t
      ? `  ${t.name}: ${t.problem}`
      : `  ${t.name}: deployment ${t.deployment}, agents ${t.agents.join(', ') || '(none)'}`,
  );
  return sanitizeForTerminal([`Teams in ${dir}:`, ...lines].join('\n'));
}
