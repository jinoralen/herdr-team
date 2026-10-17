# herdr-agent-hub

A Herdr plugin, powered by a one-shot CLI app compiled with Bun to a single executable. Herdr runs
it (`tick`) when an agent changes state; agents run its commands (`join`, `message`, …). State
lives in one SQLite database. No server, no UI. README.md covers usage and the module layout under
`src/`.

## Bun

Bun is the runtime, package manager, test runner and type checker: `bun install`, `bun test`,
`bun check`, `bunx`. Reach for Bun's APIs (`Bun.spawn`, `Bun.file`, `bun:sqlite`) before Node's or
a new dependency. Bun's docs are in `node_modules/bun-types/docs/`.

## Working on the code

- Finish with `bun run verify` (Biome, type check, Knip, tests): the pre-commit hook runs the same
  checks. `bun run format` applies Biome's fixes; `bun test <path>` runs one file.
- Herdr and agents run the compiled `dist/herdr-agent-hub`, not `src/`. Tests run from source;
  trying a change in real Herdr panes needs `bun run build` first.
- Changing the schema: edit `src/store/tables.ts`, then `bun run db:generate` regenerates the one
  migration. State is disposable, so there is no upgrade path to write
  (`docs/adr/0010-state-is-disposable.md`).
- Herdr's behaviour the code depends on (events, prompt outcomes, IDs): `docs/herdr.md`.

## Agent skills

### Issue tracker
Specs and tickets live in local Markdown, with Status lines as triage labels.
Read docs/agents/issue-tracker.md before creating, fetching or updating them.

### Domain docs
Read docs/agents/domain.md before exploring or changing domain behavior.
