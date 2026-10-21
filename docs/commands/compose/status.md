# `status`

## What it does

Lists recorded deployments in the caller's workspace, the lead and helpers' phases, and its room membership
as hub reports it: pending, active, left, gone, rejected, or not a member when the handle's member
is not the one compose started. It doesn't check live pane health; when hub can't be asked, it
still lists ownership and says why the room is missing.

## When to use it

- Anyone in a Herdr pane can inspect the recorded team.
- Use it after a failed `up` to see retained ownership, or when a helper went quiet.
- `--json` prints the deployments, their agents and room states for automation.

## It's working if

- Deployment names and lead and helper handles appear with their room state, or the command reports no
  deployments.

## Where it fits

Use [up](up.md) to compare desired state with live panes and repair gaps.
Hub's [status](../hub/status.md) explains room membership and queued messages.
