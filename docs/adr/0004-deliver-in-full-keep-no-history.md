# Deliver messages in full; keep no history

A message is typed into the recipient's pane in full and deleted once delivered: the database is a
queue, not a transcript. Agents never fetch anything, so there is no `read` command and no inbox
table. Messages are capped at 16,000 chars; a longer one is refused with a command that saves it to a
file, and the agent posts the path. A queue too big for one prompt goes out over several deliveries,
never trimmed.

## Consequences

- An agent that loses a delivered message (e.g. after context compaction) can't get it back. A
  recipient-only `show mN` backed by short retention was proposed and deferred.
- `status` shows recent activity from the log (first lines only), not message bodies.
