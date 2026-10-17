// How agents run this program. Nothing puts it on PATH, so the instructions it prints carry the
// full path of whatever is running now.

import { shellQuote } from '@herdr/terminal';

function selfCommand(): string {
  // Compiled executable: its own path. Its bundled code lives under /$bunfs/.
  if (Bun.main.startsWith('/$bunfs/')) {
    return shellQuote(process.execPath);
  }
  // From source (`bun src/cli/main.ts`).
  if (Bun.main.endsWith('/src/cli/main.ts')) {
    return `${shellQuote(process.execPath)} ${shellQuote(Bun.main)}`;
  }
  // Tests and other importers: the plain name.
  return 'herdr-agent-hub';
}

export const SELF = selfCommand();
