# `down`

## What it does

Closes the helpers owned by the deployment named in `down <team>` (a team name or file). The lead and
unrelated panes remain. Only the manifest's name is needed, including if context files disappeared.

## When to use it

- Run from the user-owned lead pane to dismantle the managed team.
- Run again after a partial failure; recorded ownership survives until cleanup completes.

## Recovery

Unfinished allocations with recorded pane IDs are found across tabs, including after
moves within the workspace. Cleanup retains ownership when closing a pane fails.
If an allocation has no recorded pane ID and cannot be identified safely from its
labelled tab, the command stops and keeps its record for investigation and retry.

## Membership

Pane closure is reported to hub by Herdr events. Hub retires membership and drains
outgoing messages under its normal rules; down never writes membership itself.

## It's working if

- Managed helpers close and the lead stays open.
- Repeating down reports the deployment is already down.

## Where it fits

Use [up](up.md) to create or repair a team and [status](status.md) to inspect ownership.
