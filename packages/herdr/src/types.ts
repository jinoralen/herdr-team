// What Herdr reports, as checked when it arrives (its CLI output is outside this program's control),
// and the operations the rest of the program needs from it.
import { z } from 'zod';

export const AgentSchema = z.object({
  pane_id: z.string(),
  workspace_id: z.string().optional(),
  terminal_id: z.string(),
  agent: z.string().nullable().optional(),
  agent_status: z.string(),
  interactive_ready: z.boolean().optional(),
  // The agent's conversation; a new one (e.g. the agent restarted in the same pane) has a new value.
  agent_session: z.object({ value: z.string() }).nullable().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

// Implemented by the CLI client (client.ts), and by a fake in tests.
// A pane and the agent Herdr sees in it (agent is absent or null for none). Panes, not agents, are
// listed: Herdr's agent list leaves out a pane whose agent exited, which is then still a member's.
export interface Herdr {
  listPanes(): Promise<Agent[]>;
  // One pane as it is now; null if it closed.
  pane(paneId: string): Promise<Agent | null>;
  prompt(paneId: string, text: string): Promise<void>;
  startAgent(options: { kind: string; paneId: string; args?: string[] }): Promise<Agent>;
}

// Pane topology, including shells with no recognized agent.
export const PaneSchema = z.object({
  pane_id: z.string(),
  terminal_id: z.string(),
  tab_id: z.string(),
  workspace_id: z.string(),
});
export type Pane = z.infer<typeof PaneSchema>;
export type NewTab = { tab: string; pane: string };

export interface LayoutHerdr extends Herdr {
  listPaneTopology(workspace?: string): Promise<Pane[]>;
  createTab(options: { workspace: string; cwd: string; label: string }): Promise<NewTab>;
  listTabs(): Promise<{ tab_id: string; label?: string; workspace_id: string }[]>;
  renameTab(tab: string, label: string): Promise<void>;
  movePane(
    pane: string,
    options: { tab: string; target: string; direction: 'right' | 'down' },
  ): Promise<void>;
  closePane(pane: string): Promise<void>;
}
