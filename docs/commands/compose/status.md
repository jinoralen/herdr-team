# `status`

## What it does

Lists recorded deployments and helper phases in the caller's workspace. This reads
compose ownership only; it does not check live pane health or hub membership.

## When to use it

- Anyone in a Herdr pane can inspect the recorded team.
- Use it after a failed `up` to see retained ownership.

## It's working if

- Deployment names and helper handles appear, or the command reports no deployments.

## Where it fits

Use [up](up.md) to compare desired state with live panes and repair gaps.
Hub's [status](../hub/status.md) explains room membership and queued messages.
