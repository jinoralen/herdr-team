# The user is not a room member

The user talks to agents in their own panes and starts a conversation by asking one agent to bring
the others in; agents report back in their panes, never through the room. Since the hub runs as a
plugin with no UI, an operator console (posting as `@operator`, `/retry`, `/drop`, `/kick`, …) was
removed from the MVP. Every post comes from an agent, so delivery rules don't need a human special
case, and uncertain deliveries are handled without an operator (see 0006).
