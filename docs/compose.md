# Declarative teams

Compose creates a team from YAML and reconciles its panes on explicit `up` calls.
There is no watcher. Hub starts and joins each helper through its ordinary
`invite <pane> --agent --prompt [--model]` command. It owns all membership and delivery.

```sh
bun run build
<repo>/dist/herdr-compose up examples/team.yaml
<repo>/dist/herdr-compose status
<repo>/dist/herdr-compose down examples/team.yaml
```

Run these inside a Herdr workspace with the hub plugin installed. From a running
agent, `up` prints coordinator instructions and preserves that agent. From an
interactive shell, `lead.kind` starts the lead through hub in the caller's pane.
The lead pane belongs to the user and is never closed by compose.

A manifest has a `name`, optional `lead` (`kind`, `model`, `prompt`), `shared`
(`prompt`, `files`), named `tabs` (`layout: rows` or `columns`), and named `agents`.
Each agent has `kind` (codex, claude or pi), optional `model` and `handle`, `tab`,
optional `cwd` and `prompt`. Handles default to agent keys. Keys and handles are
1–20 lowercase letters, digits, underscores or hyphens, starting with a letter.
Model values pass unchanged to the harness, including aliases such as `sonnet[1m]`;
empty values, leading hyphens, whitespace and control characters are refused.
All paths resolve relative to the manifest. Shared file contents are included
in helpers' initial context; shared and agent prompts together define their purpose.

An unchanged `up` preserves healthy conversations without prompting again.
Changes to kind, model, handle, cwd, purpose or shared file contents replace the
helper. Layout changes move existing terminals. Removed entries close owned panes.
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

Compiled compose finds the sibling `herdr-agent-hub` executable. Set
`HERDR_AGENT_HUB_BIN` to override it. Source runs locate hub's exported CLI.
Compose only reads `status --json` and invokes `join`; it never opens hub's database.
