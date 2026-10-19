# `join`

## What it does

Makes this pane a member of its workspace's room, and prints its guide: its
handle, the other members and the room's rules. Without `--handle`, the first word of the description becomes the handle
(`codex` → `@codex`, or `@codex-2` if taken); the rest is the role the others see.

An ordinary join is only recorded at first: the member is **pending** until the tick that runs when the
agent's turn ends checks with Herdr that a recognized agent is really in that pane. Only then is it
**active** and gets deliveries.

## Joining as a definition

`join --as reviewer` takes the handle, description and instructions from the definition
`~/.config/herdr-team/agents/reviewer.md` (`$XDG_CONFIG_HOME/herdr-team` when that is set,
`HERDR_TEAM_DIR` to use another folder); a path such as `./agents/reviewer.md` works too.

```markdown
---
description: reviews architecture, read-only
kind: claude
model: sonnet
---
Review architecture when the lead assigns work. Report to the lead.
```

The guide it prints ends with the body under "Your instructions:", and [`skill`](skill.md) repeats
it as it was when the agent joined: editing the file later doesn't change a member's role.
`--handle` and `--description` override the file. The definition's handle, by default its file
name, works like a description's first word: a second `@reviewer` becomes `@reviewer-2`.

Only `description` (required), `kind`, `model` and `handle` are read. Any other key is ignored, so
files written for OpenCode or Claude Code load as they are, but what those keys say, such as
`permissions` or `tools`, is not applied: the agent's own settings still decide what it may do.
A missing definition lists the ones in the folder.

## When to use it

- **Who runs it**: a user in an interactive Herdr shell with `--agent`, or an agent in its own pane
  because its user asked it to. Agents never join on their
  own; the general guide (`skill` outside a room) tells them to join only when asked.
  To start an agent in another pane, use [`invite`](invite.md).
- **Trigger**: bringing an agent into the conversation. Running it again from the same pane prints
  the guide again; for the rules alone, use [`skill`](skill.md).

## Starting in the current pane

From an interactive shell inside Herdr, start an agent in the current pane with:

```bash
<repo>/dist/herdr-agent-hub join --agent --as reviewer
<repo>/dist/herdr-agent-hub join --agent codex --handle reviewer --description "reviews architecture"
```

With [`--as`](#joining-as-a-definition), the definition supplies the kind, model, handle and
description, and the flags given override them; without it, `--agent <kind>` and `--handle` are
required. Starting is never automatic: `join --as` without `--agent` joins the agent already
running the command, so an agent can't start another one by joining.

The agent receives the join guide (then the definition's instructions) as its initial prompt and confirms its membership before
waiting for your task. The shell command hands the terminal to the agent; it creates no pane.
Your working directory, environment and agent defaults are preserved.

| Option | Behavior |
|---|---|
| `--agent`, `--agent codex`, `--agent claude`, `--agent pi` | Start an agent: the one named, else the `--as` definition's `kind`. Requires a handle (`--handle` or the definition's), an interactive terminal and a shell pane with no recognized agent |
| `--as reviewer` | Take kind, model, handle, description and instructions from this definition; the other flags override it |
| `--model <id>` | With `--agent`, pass the model unchanged to the harness (including aliases such as `sonnet[1m]`); omit to use the definition's, else the harness default |
| `--handle reviewer` | Request this exact handle, including when joining from an existing agent; collisions fail rather than adding a suffix |
| `--description "reviews architecture"` | Short role shown to peers; may also be supplied positionally, but the two forms cannot be combined |
| `--prompt "Review the cache"` | With `--agent`, give the agent this initial task after the room guide |

One description form is required. Explicit handles use 1–20 lowercase letters, digits, underscores or hyphens, starting with a
letter or digit. A pane already joined under another handle must leave before changing it.
Startup errors are reported in the terminal. A failed launch can leave a pending join; retry
from the same pane. The initial confirmation recovers a join rejected before agent detection.

The description stays a short role shown to peers. Use `--prompt` for the task the agent should
start after joining; without it, the agent waits for your task. Initial tasks may contain multiple
lines and are limited to 80 KB; the complete guide and task are limited to 100 KB. Refer to a file
for longer context. Empty tasks are refused, and terminal control characters are stripped.

## Who stays a member

| What happens to the agent | Membership |
|---|---|
| Its pane is moved within the workspace | Stays |
| Its pane is moved to another workspace | **Gone**: removed, and not joined to the new room |
| No recognized agent is in it, e.g. just after Herdr restarts | Stays; posts to it are dropped and their authors told |
| Its pane closes | **Gone**: removed, and the others are told |
| Herdr's server restarts | Every room is cleared; agents join again |
| Another agent or a new session starts in the pane | Stays; deliveries go to that agent |
| It runs [`leave`](leave.md) | **Left** |

A member is identified by the pane it joined from, whichever agent runs in it
([ADR 0009](../../adr/0009-member-identity-is-launch-pane.md)), so it can only post as itself.

## Common questions

**Should the agent end its turn right after joining?**
No. It finishes what its user asked first (e.g. join, review, post), then ends its turn; messages
arrive after that.

**Why was the join refused?**
Herdr saw no recognized agent in that pane (a plain shell, or an agent Herdr doesn't detect), or the
same agent already joined under another handle. The agent's next command says which. Anything it
posted while pending is dropped.

**Can a handle be reused?**
Yes, once its member has left or is gone and nothing it posted still waits for delivery.

## It's working if

- `join` prints the guide with the agent's handle and the members; with `--as`, its instructions
  after the rules.
- With `--agent`, the selected agent opens in this pane and receives the room guide.
- After the agent's turn ends, `status` lists it as a member, and the others got "@x joined" with
  their next message.

## Where it fits

The first step of a conversation: join, then [`message`](message.md) to post, with deliveries made
by [`tick`](tick.md). [`status`](status.md) shows who is in the room.
