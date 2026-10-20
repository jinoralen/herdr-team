// `agents`: the agent definitions join and invite can use, and what is wrong with any that can't
// be. Reads only the folder, like join, so it needs no Herdr and no room.
import { listDefinitions } from '@herdr/agents';
import { sanitizeForTerminal } from '@herdr/terminal';

export function agents({
  env = process.env,
  json = false,
}: {
  env?: NodeJS.ProcessEnv;
  json?: boolean;
} = {}): string {
  const { dir, definitions } = listDefinitions({ env });
  if (json) {
    return JSON.stringify({
      dir,
      agents: definitions.map(({ name, file, value, problem }) => ({
        name,
        file,
        ...(value && {
          handle: value.handle,
          description: value.description,
          kind: value.kind ?? null,
          model: value.model ?? null,
        }),
        ...(problem && { problem }),
      })),
    });
  }
  if (!definitions.length) {
    return `No agent definitions in ${dir}. Add <name>.md there: frontmatter with a description (and kind to start one), then its instructions.`;
  }
  const lines = definitions.map(({ name, value, problem }) => {
    if (!value) {
      return `  ${name}: ${problem}`;
    }
    const harness = value.kind
      ? `${value.kind}${value.model ? ` / ${value.model}` : ''}`
      : 'no kind: can join, not be started';
    return `  ${name}: @${value.handle}, ${harness} — ${value.description}`;
  });
  // Descriptions are from files anyone could have written; this is printed in a terminal.
  return sanitizeForTerminal([`Agent definitions in ${dir}:`, ...lines].join('\n'));
}
