# herdr-team

A Herdr plugin, powered by a one-shot CLI app compiled with Bun to a single executable. Herdr runs
it (`tick`) when an agent changes state; agents run its commands (`join`, `message`, …). State
lives in one SQLite database. No server, no UI. README.md is the index: usage, the commands (each
with its page in `docs/commands/hub/`), and the package layout under `packages/`.

## Bun

Bun is the runtime, package manager, test runner and type checker: `bun install`, `bun test`,
`bun check`, `bunx`. Reach for Bun's APIs (`Bun.spawn`, `Bun.file`, `bun:sqlite`) before Node's or
a new dependency. Bun's docs are in `node_modules/bun-types/docs/`.

## Working on the code

- Finish with `bun run verify` (Biome, type check, Knip, tests): the pre-commit hook runs the same
  checks. `bun run format` applies Biome's fixes; `bun test <path>` runs one file.
- Herdr and agents run the compiled `dist/herdr-hub`, not the sources under `packages/`.
  Tests run from source; trying a change in real Herdr panes needs `bun run build` first.
- Changing the schema: edit `packages/hub/src/store/tables.ts`, then `bun run db:generate` regenerates the one
  migration. State is disposable, so there is no upgrade path to write
  (`docs/adr/0010-state-is-disposable.md`).
- Herdr's behaviour the code depends on (events, prompt outcomes, IDs): `docs/herdr.md`.
- When you add, rename, remove or change the behaviour of a command, create or re-sync its page in
  `docs/commands/hub/` and its line in README.md, following `docs/agents/writing-docs.md`.

## Agent skills

### Issue tracker

Specs and tickets are local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
