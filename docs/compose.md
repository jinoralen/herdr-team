# Declarative teams

Compose creates a team from YAML and reconciles its panes on explicit `up` calls.
There is no watcher. Hub starts and joins each helper through its ordinary
`invite <pane> --as <definition> --prompt` command. It owns all membership and delivery.

```sh
bun run build
<repo>/dist/herdr-compose up examples/team.yaml   # a path, or
<repo>/dist/herdr-compose up review              # ~/.config/herdr-team/teams/review.yaml
<repo>/dist/herdr-compose status
<repo>/dist/herdr-compose down review
```

Run these inside a Herdr workspace with the hub plugin installed. From a running
agent, `up` prints coordinator instructions and preserves that agent. From an
interactive shell, `lead.use` starts the lead through hub in the caller's pane.
The lead pane belongs to the user and is never closed by compose.

A team names its agents' [definitions](commands/hub/join.md#joining-as-a-definition) and adds
where they run. A manifest has a `name`, optional `lead` (`use`, `prompt`), `shared`
(`prompt`, `files`), named `tabs` (`layout: rows` or `columns`), and named `agents`.
Each agent has `use` (a definition: a name from `~/.config/herdr-team/agents/`, or a path),
optional `handle`, `tab`, optional `cwd` and `prompt` (this team's task). Kind, model, the
description peers see and the instructions come from the definition, which needs a `kind`;
`kind` and `model` in the team file are refused. Handles default to agent keys, not the
definition's handle, so two agents may use one definition. Keys and handles are
1–20 lowercase letters, digits, underscores or hyphens, starting with a letter.
Team files live in `~/.config/herdr-team/teams/` (`$XDG_CONFIG_HOME/herdr-team`, or
`HERDR_TEAM_DIR`), and `up <name>` finds them there. All paths, `use` included, resolve
relative to the manifest. Shared file contents are included
in helpers' initial context; shared and agent prompts together define their purpose.

An unchanged `up` preserves healthy conversations without prompting again.
Changes to its definition (kind, model, description, instructions), handle, cwd,
purpose or shared file contents replace the helper. Layout changes move existing terminals. Removed entries close owned panes.
Only panes recorded as owned are closed; unrelated panes in managed tabs remain.

Replacement uses hub's ordinary handle rules: after closing the old pane, `up`
may report that its handle is occupied or draining. Let ticks process closure and
outgoing messages, then retry `up`. Compose does not poll, discard queued posts,
or bypass membership collision checks. A prompt timeout can mean it arrived;
a retry replaces the uncertain helper instead of repeating its prompt.

Ownership is stored with Drizzle in a separate SQLite database, `compose.db`,
under `/tmp/herdr-compose-<uid>`. Set `HERDR_COMPOSE_DIR` to override the base.
Like hub, compose scopes state by `HERDR_SOCKET_PATH` when present. Hub state
resets do not erase ownership. An incompatible compose schema fails and preserves
the database; losing ownership requires manual cleanup of the remaining panes.
A separate SQLite lock serializes `up`/`down`; ownership updates commit after each
step. Labelled allocations allow retry to find panes after a lost creation response.

Compiled compose finds the sibling `herdr-team` executable. Set
`HERDR_TEAM_HUB_BIN` to override it. Source runs locate hub's exported CLI.
Compose only reads `status --json` and invokes `join`; it never opens hub's database.
