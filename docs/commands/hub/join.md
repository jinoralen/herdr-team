# `join`

## What it does

Makes the agent running the command a member of its pane's room, and prints its guide: its handle,
the other members and the room's rules. `join` never starts an agent and never calls Herdr, so it
works inside agent sandboxes; starting one is [`invite`](invite.md)'s job
([ADR 0011](../../adr/0011-invite-starts-agents-in-named-panes.md)).

An agent joins as an agent definition, or ad hoc with a role:

```bash
<repo>/dist/herdr-hub join reviewer
<repo>/dist/herdr-hub join --description "codex, focuses on performance"
```

Without `--handle`, the handle is the definition's, or the description's first word (`codex` →
`@codex`, or `@codex-2` if taken); the description is the role the others see.

A join is only recorded at first: the member is **pending** until the tick that runs when the
agent's turn ends checks with Herdr that a recognized agent is really in that pane. Only then is it
**active** and gets deliveries.

## Joining as a definition

`join reviewer` takes the handle, description and instructions from the definition
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

| Option | Behavior |
|---|---|
| `<agent>` | Join as this definition: a name in `agents/`, or a path |
| `--description "codex, reviews architecture"` | Short role shown to peers; required without an agent definition, overrides one's |
| `--handle reviewer` | This exact handle; collisions fail rather than adding a suffix |

Explicit handles use 1–20 lowercase letters, digits, underscores or hyphens, starting with a
letter or digit. A pane already joined under another handle must leave before changing it.

## When to use it

- **Who runs it**: an agent in its own pane, because its user asked it to. Agents never join on
  their own; the general guide (`skill` outside a room) tells them to join only when asked.
- **Trigger**: bringing an agent that is already running into the conversation. Running it again
  from the same pane prints the guide again; for the rules alone, use [`skill`](skill.md). To start
  an agent, in this pane or another, use [`invite`](invite.md).

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

- `join` prints the guide with the agent's handle and the members; as a definition, its instructions
  after the rules.
- After the agent's turn ends, `status` lists it as a member, and the others got "@x joined" with
  their next message.

## Where it fits

The first step of a conversation: join, then [`message`](message.md) to post, with deliveries made
by [`tick`](tick.md). [`status`](status.md) shows who is in the room.
