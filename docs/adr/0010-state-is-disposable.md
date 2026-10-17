# State is disposable relay state

herdr-agent-hub relays messages; it doesn't store them. The database lives in a temp directory
(`/tmp/herdr-agent-hub-<uid>`, cleared on reboot) and holds only members and undelivered messages,
which go stale fast once their agents restart. So there are no data migrations: the schema is one
migration, `drizzle/0000_init.sql`, regenerated on every change, and a database built from any
other schema is set aside on open and started fresh; agents just join again.

## Consequences

- Schema changes never need upgrade code, and `bun run db:generate` regenerates the one migration.
- Durability is not guaranteed and nothing should come to depend on it.
- Open: keeping each workspace's members across a restart would be the one piece worth persisting;
  how is undecided.
