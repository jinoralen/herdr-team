# `status`

## What it does

Shows the current workspace's room: its members, the messages not delivered yet and why each waits,
and recent activity (who posted to whom, first line only; deliveries; joins and leaves). It only
reads, so it's safe from any pane, member or not.

## When to use it

- **Who runs it**: the user or an agent, from any pane in the workspace.
- **Trigger**: a conversation went quiet, a reply didn't arrive, or you want to see who is in the
  room.

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
`herdr plugin log list --plugin herdr-agent-hub`.

## It's working if

- It lists the members you expect, and once they're idle no member shows plain messages waiting.
  FYIs, notices and messages marked as possibly undelivered may stay: they wait for the next
  message that wakes the member.

## Where it fits

The debugging view over [`message`](message.md) and [`tick`](tick.md). To stop a runaway
conversation, tell an agent to stop replying or to [`leave`](leave.md), or close its pane.
