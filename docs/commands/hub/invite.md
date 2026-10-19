# `invite`

## What it does

Starts an agent in another existing shell pane and brings it into that pane's room: it waits until
the agent is a member, submits its guide (and the definition's instructions, then the `--prompt`
task) once, and returns. It only ever touches the pane it is given, and never types into a pane where
an agent already runs: that is refused, with the line to paste into that agent instead.

## When to use it

- **Who runs it**: the user, or a lead agent bringing in helpers (compose does it for each helper);
  see [ADR 0011](../../adr/0011-invite-starts-agents-in-named-panes.md).
- **Trigger**: an agent should join from a pane you already made. To start one in your own shell
  pane, use [`join --agent`](join.md#starting-in-the-current-pane); to bring in an agent that is
  already running, tell it to run `join --as …` (the refusal prints the exact line).

```bash
<repo>/dist/herdr-team invite w1:p3 --as reviewer --prompt "Review the cache design"
<repo>/dist/herdr-team invite w1:p3 --agent codex --handle reviewer --description "reviews architecture"
```

## Options

| Option | Behavior |
|---|---|
| `<pane>` | An existing Herdr shell pane, e.g. `w1:p3`; its workspace supplies the room |
| `--as reviewer` | Take kind, model, handle, description and instructions from this [definition](join.md#joining-as-a-definition); the flags below override it |
| `--agent codex`, `claude`, `pi` | The agent to start; required without `--as` |
| `--handle reviewer` | This exact handle; collisions fail before anything starts. Required without `--as` |
| `--description "…"` | Short role shown to peers. Required without `--as` |
| `--model <id>` | Passed unchanged to the harness (aliases such as `sonnet[1m]` included) |
| `--prompt "…"` | Initial task after the guide: up to 80 KB, 100 KB with the guide |

The command creates, moves and closes no panes: making and arranging them stays with the caller,
such as compose. Herdr starts the agent in the pane's shell, with its working directory,
environment and agent defaults. No interactive terminal is needed.

## Uncertain outcomes

Success means the agent was detected in the original terminal, its membership is active and the
guide was submitted, not that it has read the guide. An error after startup begins can leave an
agent or membership behind, and a prompt timeout can mean the guide arrived. Inspect the target
pane and [`status`](status.md) in its workspace before retrying; nothing is retried automatically.

## It's working if

- The caller gets a confirmation naming the handle, pane and room.
- The agent opens in the target pane with the room guide; `status` there lists it as a member.

## Where it fits

How a pane you made joins the conversation, the way [`join`](join.md) is how a pane joins itself;
then [`message`](message.md) and deliveries as usual.
