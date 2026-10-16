// What Herdr reports, as checked when it arrives (its CLI output is outside this program's control),
// and the operations the rest of the program needs from it.
import { z } from 'zod';

export const AgentSchema = z.object({
  pane_id: z.string(),
  terminal_id: z.string(),
  agent: z.string().nullable().optional(),
  agent_status: z.string(),
  interactive_ready: z.boolean().optional(),
  // The agent's conversation; a new one (e.g. the agent restarted in the same pane) has a new value.
  agent_session: z.object({ value: z.string() }).nullable().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

// Implemented by the CLI client (client.ts), and by a fake in tests.
export interface Herdr {
  listAgents(): Promise<Agent[]>;
  // One pane's agent as it is now; null if Herdr has no agent there.
  agent(paneId: string): Promise<Agent | null>;
  prompt(paneId: string, text: string): Promise<void>;
}
