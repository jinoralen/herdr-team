// Pane layout operations used by compose; agent startup stays with hub.
import { z } from 'zod';
import { cliHerdr, HerdrError, run } from './client.ts';
import { type LayoutHerdr, type NewTab, type Pane, PaneSchema } from './types.ts';
export function cliLayoutHerdr(env = process.env): LayoutHerdr {
  const bin = env.HERDR_BIN_PATH || 'herdr';
  return {
    ...cliHerdr(env),
    async listPaneTopology(workspace?: string): Promise<Pane[]> {
      const result = await run(
        bin,
        ['pane', 'list', ...(workspace ? ['--workspace', workspace] : [])],
        { timeout: 10000, env },
      );
      const parsed = z.object({ panes: z.array(PaneSchema) }).safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'pane list has invalid data');
      }
      return parsed.data.panes;
    },
    async createTab({
      workspace,
      cwd,
      label,
    }: {
      workspace: string;
      cwd: string;
      label: string;
    }): Promise<NewTab> {
      const result = await run(
        bin,
        ['tab', 'create', '--workspace', workspace, '--cwd', cwd, '--label', label, '--no-focus'],
        { timeout: 10000, env },
      );
      const parsed = z
        .object({
          tab: z.object({ tab_id: z.string() }),
          root_pane: z.object({ pane_id: z.string() }),
        })
        .safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'tab create has invalid data');
      }
      return { tab: parsed.data.tab.tab_id, pane: parsed.data.root_pane.pane_id };
    },
    async listTabs(): Promise<{ tab_id: string; label?: string; workspace_id: string }[]> {
      const result = await run(bin, ['tab', 'list'], { timeout: 10000, env });
      const parsed = z
        .object({
          tabs: z.array(
            z.object({
              tab_id: z.string(),
              label: z.string().optional(),
              workspace_id: z.string(),
            }),
          ),
        })
        .safeParse(result);
      if (!parsed.success) {
        throw new HerdrError('invalid_response', 'tab list has invalid data');
      }
      return parsed.data.tabs;
    },
    async renameTab(tab: string, label: string): Promise<void> {
      await run(bin, ['tab', 'rename', tab, label], { timeout: 10000, env });
    },
    async movePane(
      pane: string,
      { tab, target, direction }: { tab: string; target: string; direction: 'right' | 'down' },
    ): Promise<void> {
      await run(
        bin,
        [
          'pane',
          'move',
          pane,
          '--tab',
          tab,
          '--target-pane',
          target,
          '--split',
          direction,
          '--no-focus',
        ],
        { timeout: 10000, env },
      );
    },
    async closePane(pane: string): Promise<void> {
      await run(bin, ['pane', 'close', pane], { timeout: 10000, env });
    },
  };
}
