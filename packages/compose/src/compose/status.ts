// Recorded deployments in one workspace; no room or live Herdr access.

import { requirePaneContext } from '@herdr/herdr';
import { sanitizeForTerminal } from '@herdr/terminal';
import { deployments, rootDir } from '#store';

export function status({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}): string {
  const { workspace } = requirePaneContext(env);
  const states = deployments(rootDir(env), workspace);
  return sanitizeForTerminal(
    states
      .map(
        (d) =>
          `Deployment ${d.name}: ${
            Object.entries(d.agents)
              .map(([key, a]) => `${key}=@${a.handle} (${a.phase})`)
              .join(', ') || 'no agents'
          }`,
      )
      .join('\n') || 'No deployments in this workspace.',
  );
}
