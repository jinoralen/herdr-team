# Compose

Owns YAML desired state, pane layout and deployment ownership. Starts agents through
hub's ordinary commands; it never reads or writes hub storage.

- `src/compose/`: manifests, reconciliation, hub command wrapper and CLI.
- `src/store/`: Drizzle ownership records in compose.db and the reconciliation lock.

After editing `src/store/tables.ts`, regenerate the single migration with
`bun run --filter @herdr/compose db:generate`. An incompatible ownership database
is preserved and refused; it is never reset like disposable hub membership.

See [configuration](../../docs/compose.md) and the [repository guide](../../README.md).
