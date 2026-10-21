# `status`

## What it does

Shows the current workspace's room: its members, the messages not delivered yet and why each waits,
and recent activity (who posted to whom, first line only; deliveries; joins and leaves). It only
reads, so it's safe from any pane, member or not.

## When to use it

- **Who runs it**: the user or an agent, from any pane in the workspace.
- **Trigger**: a conversation went quiet, a reply didn't arrive, or you want to see who is in the
  room.
- The guide points agents here only when a reply seems overdue: it is not an inbox, and messages
  reach them only as deliveries. For their own handle and the members, use [`guide`](guide.md).

## Common questions

**Why did every agent go quiet?**
Usually the conversation ended: everyone answered or closed with `--fyi`, and nobody asked anything
more. If an answer was posted as `--fyi`, it woke nobody, so the asker never heard back; see
[`message`](message.md).

**Why is a message waiting?**
`status` gives the reason per member: it is working, waiting on an approval in its pane, or Herdr
cannot take input yet, or no agent is running in its pane (then posts to it are dropped and their
authors told).

**Where are errors from ticks?**
In `status`'s recent activity, and in Herdr's plugin log:
`herdr plugin log list --plugin herdr-team`.

## It's working if

- It lists the members you expect, and once they're idle no member shows plain messages waiting.
  FYIs, notices and messages marked as possibly undelivered may stay: they wait for the next
  message that wakes the member.

## Automation

Use `status --json` for a machine-readable snapshot of the caller's workspace room. It is
compose's view of the room, not a stable API: it carries no version, and its fields change with
the build. Compose comes from the same build and refuses a snapshot it can't parse
([ADR 0012](../../adr/0012-hub-stands-alone-compose-builds-on-its-cli.md)). Scripts may read it,
but must be updated with the plugin.

The object contains `room` and `members` (including left, gone and rejected records). Each member includes its handle, description, launch pane,
join timestamp, status, terminal, agent, reason, held state, and `queuedFrom`.
Members are ordered by handle. The snapshot includes only these fields, without member
instructions. It is read in one statement, makes no Herdr calls, and describes recorded
membership, not live pane health. Before the first tick, or while the database is still being
created, it returns an empty room without creating one. A database this build is current with is
read without reserving a write lock; any other is opened as every command opens it, so one from
another build is moved aside and a fresh one started.

A handle is reusable when its status is left, gone or rejected and `queuedFrom`
is false. Orchestrators closing a pane must wait for a tick to mark it gone and
for outgoing messages to drain before joining a replacement with that handle.

## Where it fits

The debugging view over [`message`](message.md) and [`tick`](tick.md). To stop a runaway
conversation, tell an agent to stop replying or to [`leave`](leave.md), or close its pane.
