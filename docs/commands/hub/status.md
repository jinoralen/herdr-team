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
  reach them only as deliveries. For their own handle and the members, use [`skill`](skill.md).

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

Use `status --json` for a machine-readable snapshot of the caller's workspace room.
The object contains `version`, `room` and `members` (including left, gone and
rejected records). `version` (now 1) changes when a field others may read changes or goes away;
compose reads this snapshot and refuses a version it doesn't know
([ADR 0012](../../adr/0012-hub-stands-alone-compose-builds-on-its-cli.md)). Each member includes its handle, description, launch pane,
join timestamp, status, terminal, agent, reason, held state, and `queuedFrom`.
The snapshot is read in one transaction and makes no Herdr calls. It describes
recorded membership, not live pane health.

A handle is reusable when its status is left, gone or rejected and `queuedFrom`
is false. Orchestrators closing a pane must wait for a tick to mark it gone and
for outgoing messages to drain before joining a replacement with that handle.

## Where it fits

The debugging view over [`message`](message.md) and [`tick`](tick.md). To stop a runaway
conversation, tell an agent to stop replying or to [`leave`](leave.md), or close its pane.
