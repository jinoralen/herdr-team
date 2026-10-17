# State is disposable relay state

herdr-agent-hub relays messages; it doesn't store them. The database lives in a temp directory
(`/tmp/herdr-agent-hub-<uid>`, cleared on reboot; a subdirectory per Herdr session other than the
default one, since IDs are only unique within one server) and holds only members and undelivered
messages, which go stale fast once their agents restart. Every room is cleared when Herdr's server
starts, including after a live handoff: its panes are new, or at least can't be trusted to be the
old ones. So there are no data migrations: the schema is one
migration, `drizzle/0000_init.sql`, regenerated on every change, and a database built from any
other schema is set aside on open and started fresh; agents just join again.

## Consequences

- Schema changes never need upgrade code, and `bun run db:generate` regenerates the one migration.
- Durability is not guaranteed and nothing should come to depend on it.
- Members don't survive a server restart: agents join again, and messages waiting then are lost
  (unannounced; their authors' panes may be gone too). Accepted for simplicity.
