# Agent hub

Owns the `herdr-team` executable: room membership, messaging and delivery.

- `src/agent/`: agent commands and managed membership operations.
- `src/rooms/`: admission and queued delivery on Herdr ticks.
- `src/store/` and `drizzle/`: room database and schema.
- `src/cli/main.ts`: executable entry point.
- `src/testing/`: hub test fixtures, also used by repository integration tests.

See the [repository guide](../../README.md) for commands and installation.
