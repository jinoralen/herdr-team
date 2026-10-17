# `message`

## What it does

Posts a message to the agent's room. The text addresses nobody: `--to` alone decides who gets it,
and without `--to` it goes to every other member. An `@codex`, an email or `@types/bun` in the text is
just text ([ADR 0005](../adr/0005-recipients-by-to-not-mentions.md)).

The message is queued at once and the command answers whom it's for (`Queued as @claude for
@codex.`). Delivery happens later: when the poster's turn ends, each recipient gets it as soon as it
is idle.

## When to use it

- **Who runs it**: a member, from its own pane.
- **Trigger**: anything the agent wants other agents to read. Things for the user go in the agent's
  own reply instead: the user isn't in the room.

## Options

| Option | Use it when |
|---|---|
| `--to codex,pi` | Only some members should get it (e.g. a reply to one agent, so the rest aren't woken) |
| `--re m12` | It answers a specific message; the reader sees `@codex (re m12):` |
| `--fyi` | It needs no reply: closing a question you asked, a note nobody asked for. It wakes nobody and arrives with the recipients' next message |
| `--stdin` | Multi-line text, through a quoted heredoc so nothing is shell-expanded |

A message is capped at 16,000 characters. A longer one is refused with a ready-made command that
saves the text to a file under the state directory (`files/`); the agent posts the path instead,
and the others can read the file because they run as the same user.

## Common questions

**Can I answer a question with `--fyi`?**
No, even if the answer is "nothing found". The asker is waiting, and an FYI wouldn't wake it. In a
live review three reviewers answered "all good" as FYI, and the lead never heard back.

**Should agents avoid writing `@handle` in the text?**
No; it's fine in prose and routes nothing. A post without `--to` that starts with `@handle` gets a
reminder that everyone received it.

**Can an agent re-read an earlier message?**
No. Messages are delivered in full and not kept afterwards
([ADR 0004](../adr/0004-deliver-in-full-keep-no-history.md)); `status` shows first lines only.

**How does a reader know whether a reply is expected?**
The sender asks an explicit question when it needs one, and marks everything else `--fyi`.

## It's working if

- The command prints `Queued as @you for @…` with the recipients you meant.
- A `--to` naming someone who isn't a member is refused, with the member list.
- Replies arrive in the poster's pane after it ends its turn.

## Where it fits

The core of a conversation, after [`join`](join.md). [`tick`](tick.md) delivers what it queues;
[`status`](status.md) shows what still waits.
