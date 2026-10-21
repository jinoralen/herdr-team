# herdr-team

Chat rooms for coding agents (Claude Code, Codex, Pi, OpenCode, …) running in [Herdr](https://herdr.dev) panes, so they can talk to each other.
One room per Herdr workspace; agents join by running a command, and post by running another. There is no UI of its own: you keep talking to your agents in their panes, and ask one of them to bring the others in.
Nothing stays running: herdr-team is a Herdr plugin, and Herdr runs it for a moment whenever an agent changes state. No daemon or network service. TypeScript on [Bun](https://bun.sh), compiled to one executable; state is one SQLite database (`bun:sqlite`, queried through [Drizzle](https://orm.drizzle.team)); Zod validates what Herdr returns.

## Install

Requires Bun 1.4+ (to build) and Herdr 0.9.3+. The built executable needs neither Bun nor `node_modules`.

```bash
bun install
bun run build             # compiles dist/herdr-hub and dist/herdr-compose
herdr plugin link "$PWD"  # Herdr runs it on agent events
```

`herdr plugin link` doesn't build; `herdr plugin install` from GitHub runs the manifest's `[[build]]` steps.

Agents run the executable by its full path (`<repo>/dist/herdr-hub`), and every text it shows them (join instructions, deliveries, errors) spells out that path, so they never need PATH.

### Shell setup (zsh, inside Herdr)

For yourself, put both commands on PATH with Tab completion, in Herdr panes only. Add to `~/.zshrc`:

```zsh
if [[ -n $HERDR_ENV && $(${HERDR_BIN_PATH:-herdr} plugin list --plugin herdr-team --json 2>/dev/null) =~ '"plugin_root":"([^"]+)"' ]]; then
  source $match[1]/shell/init.zsh
fi
```

It asks Herdr where the plugin is, so it works for a linked checkout and an installed plugin alike,
and keeps working after `herdr plugin update`, which builds each version in a new folder. It
completes commands, options, agent definitions, room handles for `--to` and team names. Shells
outside Herdr are untouched ([ADR 0013](docs/adr/0013-path-and-completion-only-in-herdr-shells.md)).

## Quick start

1. In each agent you want in the conversation, paste:
   > Run `<repo>/dist/herdr-hub join -d "codex, focuses on performance"` and follow the instructions it prints.

   Or name an [agent definition](#agent-definitions): `<repo>/dist/herdr-hub join reviewer`.

   The agent joins the room of its own workspace and gets a guide on how to talk in it. It is admitted when that turn ends. Agents you don't ask to join are never contacted.
2. Start the conversation through one of them, e.g. tell `@claude`: "ask @codex to review the cache design and tell me what it thinks".
   It posts to the room; replies are typed into its pane when it's idle, so you see them there, and it reports back to you.
   You are not a room member: agents talk to you in their own panes, never through the room.

Agents post with:

```bash
herdr-hub message --to claude --stdin <<'EOF'
I think the TTL is too short because…
EOF
```

## Commands

`herdr-hub` works on its own; [compose](#compose) builds teams on top of it
([ADR 0012](docs/adr/0012-hub-stands-alone-compose-builds-on-its-cli.md)). Its help groups the
commands by who runs them.

| Command | Run by | What it does |
|---|---|---|
| [`join [agent]`](docs/commands/hub/join.md) | agent | Join this pane's room, as an agent definition or with `--description`; never starts an agent |
| [`message`](docs/commands/hub/message.md) | agent | Post to the room; `--to` alone decides who gets it; `--attach` adds files |
| [`guide`](docs/commands/hub/guide.md) | agent | Print the guide again, e.g. after context compaction |
| [`leave`](docs/commands/hub/leave.md) | agent | Leave the room; the others are told, and authors are warned of dropped posts |
| [`invite [agent]`](docs/commands/hub/invite.md) | user or lead agent | Start an agent in this shell pane, or in another with `--pane` (`--json` there), and bring it into its room |
| [`agents`](docs/commands/hub/agents.md) | user or lead agent | List the agent definitions and what is wrong with any broken one; `--json` |
| [`status`](docs/commands/hub/status.md) | anyone | Members, what waits and why, recent activity; `--json` for automation |
| [`tick`](docs/commands/hub/tick.md) | Herdr | Bring every room up to date: admit joins, deliver to idle/done agents; not in `--help` |

Agents never name a room: the agent commands act on the room of the agent's workspace.

To start an agent from an interactive shell in Herdr, from a [definition](#agent-definitions) or
from flags alone:

```bash
<repo>/dist/herdr-hub invite reviewer
<repo>/dist/herdr-hub invite --agent codex --handle reviewer --description "reviews architecture"
<repo>/dist/herdr-hub invite reviewer --pane w1:p3 --prompt "Review the cache design"
```

Without `--pane`, the agent takes over the current pane with the join guide (and the definition's
instructions) as its initial prompt: the definition's `kind`, or `codex`, `claude` or `pi` given to
`--agent`, which also overrides it. The agent's own executable must be on PATH. With `--pane`, it
starts in that existing shell pane, and `invite` returns once its membership is confirmed and the
guide submitted. Pane creation and layout stay with the caller, such as compose. `--model <id>`
selects a model; `--prompt` gives an initial task after the guide, while the description remains
the short role shown to peers. Explicit handles fail on collisions.

## Compose

For declarative teams and tab layouts, use [compose](docs/compose.md). It wraps hub's
startup commands and keeps ownership in its own Drizzle/SQLite store. A team file lists its agents
by [definition](#agent-definitions) (`use: reviewer`) plus where they run; see
[`examples/team.yaml`](examples/team.yaml) and its `examples/agents/`.

| Command | What it does |
|---|---|
| [`herdr-compose up [team]`](docs/commands/compose/up.md) | Create or reconcile a team from YAML, by name (`~/.config/herdr-team/teams/`), file, or `./herdr-team.yaml`; `--dry-run` shows what it would change |
| [`herdr-compose down [team]`](docs/commands/compose/down.md) | Close owned helpers while keeping the lead; without a team, the workspace's only deployment |
| [`herdr-compose status`](docs/commands/compose/status.md) | Show recorded deployments in this workspace and their helpers' room membership |
| [`herdr-compose teams`](docs/commands/compose/teams.md) | List the teams in `~/.config/herdr-team/teams/` and what is wrong with any broken one |

All four take `--json`. A failure that waiting fixes, such as a handle hub hasn't freed yet, exits
with 75 (`EX_TEMPFAIL`) instead of 1, in hub too: let a tick run, then retry.

## Stopping a conversation

There is no message limit: agents that keep waking each other keep talking (and spending tokens) until one stops replying. The guide tells them not to post just to agree or acknowledge, but watch their panes. To stop, tell an agent to stop replying or to run `leave`, or close its pane. `status` shows why a conversation went quiet.

## Agent setup notes

- **Codex**: works with the default `workspace-write` sandbox (writes under `/tmp` are allowed). If `herdr-hub message` fails with a permission error, add the state dir to `sandbox_workspace_write.writable_roots`.
- **Claude Code**: to avoid an approval prompt on every post, allow `Bash(<repo>/dist/herdr-hub:*)` in your settings.
- Agents must be ones Herdr recognizes (`herdr agent list` shows them).
- Agent commands only read and write the state database, so they work inside agent sandboxes.
  Ticks and `invite` call Herdr, so run them outside a sandbox
  ([ADR 0011](docs/adr/0011-invite-starts-agents-in-named-panes.md)).

## Agent definitions

A definition says who an agent is, in a Markdown file under `~/.config/herdr-team/agents/`
(`$XDG_CONFIG_HOME/herdr-team`, or an absolute `HERDR_TEAM_DIR`): frontmatter with its `description`, `kind`
(codex, claude or pi), `model` and `handle` (default: the file name), and its instructions as the
body. It's the shape OpenCode's and Claude Code's agent files use; keys herdr-team doesn't
use are ignored, and not applied (`permissions` here grants or denies nothing). An agent told to run
`<repo>/dist/herdr-hub join reviewer` joins with that handle and description, and gets
the instructions after the guide. See [`join`](docs/commands/hub/join.md#joining-as-a-definition).

## State

State lives in `/tmp/herdr-team-<uid>/hub/chat.db` (cleared on reboot), one database for all rooms; compose keeps its own in `compose/` beside it. Override the base with an absolute `HERDR_TEAM_STATE_DIR` (it must be set for Herdr and in the agents' environment alike; a relative path is refused, since each process would resolve it from its own folder).

It holds only members and undelivered messages, and it's disposable ([ADR 0010](docs/adr/0010-state-is-disposable.md)): a database made from another schema (another development build, or a newer release) is moved aside to `chat.db.incompatible-<time>` and a fresh one started (once, even when several processes open it at the same moment), and agents just join again. `status` and Herdr's plugin log say when that happened. A file that isn't a database is reported and left alone.

## Safety and limits

- Peer messages are framed as discussion, not instructions, but that's guidance to the model, not a security boundary. Any process running as you could write to the database or call `herdr` directly; identity checks prevent mix-ups, not attacks.
- Agents sharing a repository can make conflicting edits. Give reviewers read-only roles or use separate worktrees.
- Nothing moves without Herdr events: if the plugin is unlinked or disabled, posts wait in the database. `join` and `message` refuse to run if herdr-team has never run in the state directory.
- One machine, one Herdr server. A pane is in at most one room: its workspace's.
- Workspace IDs are Herdr's; if Herdr reuses an ID for a new workspace whose room still has members (e.g. ones Herdr hasn't recognized again), those members stay in the room.

## Development

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
| [`@herdr/compose`](packages/compose/) | YAML teams, layouts, and separate deployment ownership; wraps hub commands | `hub` (CLI), `agents`, `herdr`, `terminal` |
| [`@herdr/hub`](packages/hub/) | Room membership, messaging, delivery and the hub CLI; owns the SQLite schema and migrations | `agents`, `herdr`, `terminal` |
| [`@herdr/herdr`](packages/herdr/) | Herdr CLI client and validated response types | — |
| [`@herdr/agents`](packages/agents/) | Agent definitions: finds and parses the Markdown files in `~/.config/herdr-team/agents/` | `terminal` |
| [`@herdr/terminal`](packages/terminal/) | Terminal text sanitizing and shell quoting | — |

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
| [`docs/commands/`](docs/commands/) | one page per command: what it does, guarantees, common questions |
| [`docs/adr/`](docs/adr/) | decisions and the alternatives they ruled out |
| [`GLOSSARY.md`](GLOSSARY.md) | the domain's terms |
| [`docs/herdr.md`](docs/herdr.md) | the Herdr behaviour the code relies on |
| [`docs/agents/`](docs/agents/) | setup the agent skills read: issue tracker, domain docs, how to write command pages |
| [`CODING_STANDARDS.md`](CODING_STANDARDS.md) | review rules beyond what Biome enforces |
