# `invite`

## What it does

Starts an agent and brings it into its pane's room: the only way an agent is started
([ADR 0011](../../adr/0011-invite-starts-agents-in-named-panes.md)). It only ever touches one pane,
the current one or the one named with `--pane`, and never types into a pane where an agent already
runs: that is refused, with the `join` line to paste into that agent instead.

## When to use it

- **Who runs it**: the user, or a lead agent bringing in helpers in other panes (compose does it for
  the lead and each helper).
- **Trigger**: an agent should be started, in your shell pane or one you already made. To bring in
  an agent that is already running, tell it to run [`join`](join.md) (the refusal prints the exact
  line).

## Where it starts

```bash
<repo>/dist/herdr-hub invite reviewer                                  # in this shell pane
<repo>/dist/herdr-hub invite reviewer --pane w1:p3 --prompt "Review the cache design"
<repo>/dist/herdr-hub invite --agent codex --handle reviewer --description "reviews architecture"
```

| Where | What happens |
|---|---|
| No `--pane` | Run from an interactive Herdr shell: the agent takes over this terminal, with the guide (then the definition's instructions, then the `--prompt` task) as its first prompt, and confirms its membership itself. It creates no pane |
| `--pane w1:p3` | An existing shell pane: the agent starts there; `invite` waits until it is a member, submits the guide once, and returns. No interactive terminal is needed |

## Options

| Option | Behavior |
|---|---|
| `<agent>` | Take kind, model, handle, description and instructions from this [definition](join.md#joining-as-a-definition); the flags below override it |
| `--pane w1:p3` | Start in this existing shell pane instead of the current one; its workspace supplies the room |
| `--agent codex`, `claude`, `pi` | The agent to start; required without a definition with a `kind` |
| `--handle reviewer` | This exact handle; collisions fail before anything starts. Required without a definition |
| `-d`, `--description "…"` | Short role shown to peers. Required without a definition |
| `--model <id>` | Passed unchanged to the harness (aliases such as `sonnet[1m]` included) |
| `--prompt "…"` | Initial task after the guide: up to 80 KB, 100 KB with the guide |
| `--json` | With `--pane`: one JSON line on stdout, `{ ok, agent, handle, pane, room, uncertain }` on success, `{ ok: false, error, uncertain }` on failure |

The description stays a short role shown to peers; `--prompt` is the task the agent starts on, and
without it the agent waits for your task. Refer to a file for longer context. Empty tasks are
refused, and terminal control characters are stripped.

The command creates, moves and closes no panes: making and arranging them stays with the caller,
such as compose. The agent starts in the pane's shell, with its working directory, environment and
agent defaults.

## Uncertain outcomes

With `--pane`, success means the agent was detected in the original terminal, its membership is
active and the guide was submitted, not that it has read the guide. An error after startup begins
can leave an agent or membership behind, and a prompt timeout can mean the guide arrived. Inspect
the target pane and [`status`](status.md) in its workspace before retrying; nothing is retried
automatically; with `--json`, `uncertain: true` says so. A handle whose old member still has posts
to deliver exits with 75: retry after a tick. Without `--pane`, startup errors are reported in your terminal; a failed launch can
leave a pending join, so retry from the same pane.

## It's working if

- Without `--pane`, the agent opens in your pane with the room guide and confirms its membership.
- With `--pane`, you get a confirmation naming the handle, pane and room, and the agent opens in
  that pane with the room guide.
- `status` in the pane's workspace lists it as a member.

## Where it fits

How a new agent comes into the conversation, the way [`join`](join.md) is how a running one does;
then [`message`](message.md) and deliveries as usual. Compose builds teams on it
([compose](../../compose.md)).
