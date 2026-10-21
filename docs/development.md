# Development

herdr-team is a one-shot Herdr plugin written in TypeScript on Bun. It compiles to standalone executables, uses SQLite through Drizzle for state, and validates Herdr responses with Zod.


| | |
|---|---|
| `bun test` | run package and repository tests from source |
| `bun run dev <command>` | run the CLI from source, e.g. `bun run dev status` |
| `bun run build` | empty `dist/`, then compile `dist/herdr-hub` and `dist/herdr-compose`; Herdr and agents run them, so rebuild after editing `packages/` |
| `bun run db:generate` | after changing the tables in `packages/hub/src/store/tables.ts`: regenerate the one migration, `packages/hub/drizzle/0000_init.sql` |
| `bun run verify` | lint, type check, Knip, then the tests |
| `bun check` | type check all packages and repository tests (Bun's built-in checker) |
| `bun run lint`, `bun run format` | Biome: check, or apply formatting and safe fixes |
| `bun run knip` | Knip: unused files, exports and dependencies |

### Code layout

This is a Bun workspace. Each package owns its source, dependencies and TypeScript configuration.
The root owns shared tooling, the lockfile and repository tests. Build outputs remain in `dist/` so
the Herdr plugin manifest and installed commands keep their paths.

| Package | Responsibility | Runtime workspace dependencies |
|---|---|---|
| [`@herdr/compose`](../packages/compose/) | YAML teams, layouts, and separate deployment ownership; wraps hub commands | `hub` (CLI), `agents`, `herdr`, `terminal` |
| [`@herdr/hub`](../packages/hub/) | Room membership, messaging, delivery and the hub CLI; owns the SQLite schema and migrations | `agents`, `herdr`, `terminal` |
| [`@herdr/herdr`](../packages/herdr/) | Herdr CLI client and validated response types | — |
| [`@herdr/agents`](../packages/agents/) | Agent definitions: finds and parses the Markdown files in `~/.config/herdr-team/agents/` | `terminal` |
| [`@herdr/terminal`](../packages/terminal/) | Terminal text sanitizing and shell quoting | — |

Shared packages expose only their `index.ts` through package `exports`. Within a package, modules
import each other as `#<module>` (for example `import { Store } from '#store'`; Node's subpath
imports, listed under `imports` in the package's `package.json`), which means its `index.ts`: the
list of what it offers. The rest of its files are internal. Biome enforces this
(`noRestrictedImports`), and keeps Drizzle and `bun:sqlite` inside `store/`. Imports between
packages use `@herdr/...` names and declared `workspace:*` dependencies.

| Hub module | What it does | Uses |
|---|---|---|
| `cli/` | the command line (`main.ts`, the entry point) | all of the below |
| `rooms/` | admitting members and delivering what is queued for them; one pass at a time under a lock | `agent`, `store`, `herdr` |
| `agent/` | what agents run (`join`, `message`, `status`, …) and the text they read | `store` |
| `store/` | the SQLite database: tables, migrations, queries | — |

Each hub module keeps its tests in its own `tests/` folder (`rooms/tests/delivery.test.ts`, `store/tests/store.test.ts`, …), one file per subject. Tests may use their own module's internal files, but other modules only through `index.ts`. Their shared helpers (a fake Herdr, a fresh state directory) are in `testing/`. The command line is tested by running the real program in a child process against a fake `herdr` executable (`tests/cli/`).

```bash
bun run build:hub                           # build only hub
bun run --filter @herdr/hub test            # hub's package tests
bun run --filter '@herdr/*' typecheck       # check each package independently
HERDR_TEST_BIN_DIR="$PWD/dist" bun test ./tests/cli ./tests/compose ./packages/compose   # against the built executables
```

`bun install` also installs git hooks ([lefthook](https://lefthook.dev), `lefthook.yml`): pre-commit runs Biome on staged files, the type check and Knip; pre-push runs the tests. Skip one once with `--no-verify`.

Biome checks formatting, module import boundaries, cognitive complexity, unused imports, declared parameter and return types (`useExplicitType`), and non-null assertions outside tests.

### Docs

| Where | What |
|---|---|
| [`docs/commands/`](commands/) | one page per command: what it does, guarantees, common questions |
| [`docs/adr/`](adr/) | decisions and the alternatives they ruled out |
| [`GLOSSARY.md`](../GLOSSARY.md) | the domain's terms |
| [`docs/herdr.md`](herdr.md) | the Herdr behaviour the code relies on |
| [`docs/agents/`](agents/) | setup the agent skills read: issue tracker, domain docs, how to write command pages |
| [`CODING_STANDARDS.md`](../CODING_STANDARDS.md) | review rules beyond what Biome enforces |
