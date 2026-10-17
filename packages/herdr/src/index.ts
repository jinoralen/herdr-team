// Herdr, the terminal workspace manager the agents run in. Only this module runs its CLI.
export { cliHerdr, HerdrError } from './client.ts';
export { cliLayoutHerdr } from './layout.ts';
export type { Agent, Herdr, LayoutHerdr, NewTab, Pane } from './types.ts';
export function requirePaneContext(env = process.env): { pane: string; workspace: string } {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
    throw new Error('Run this command inside a Herdr pane.');
  }
  return { pane: env.HERDR_PANE_ID, workspace: env.HERDR_WORKSPACE_ID };
}
