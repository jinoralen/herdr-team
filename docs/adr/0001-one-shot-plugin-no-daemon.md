# One-shot plugin, no daemon

herdr-agent-hub is a Herdr plugin: Herdr runs `herdr-agent-hub tick` on every agent state change, the
tick runs requested passes and exits, and agents' commands only write to the database. Nothing stays running,
so there is no process to start, supervise or crash, and no socket to secure. The price is that
nothing moves without a Herdr event, and concurrent ticks need a lock in the database to take turns.

## Considered options

- A daemon or local server holding the rooms in memory: rejected; it needs lifecycle management and
  a socket, and Herdr's events already arrive exactly when delivery can happen (a turn ends, an
  agent goes idle).
