# `down`

## What it does

Closes the helpers owned by a deployment. The lead and unrelated panes remain. `down review` names
it by team name or file, of which only the manifest's name is read, so it works even if context
files disappeared. `down` alone takes this workspace's only deployment, and refuses with their
names when there are several. `--json` prints the deployment taken down and the handles removed.

## When to use it

- Run from the user-owned lead pane to dismantle the managed team.
- Run again after a partial failure; recorded ownership survives until cleanup completes.

## Recovery

Unfinished allocations with recorded pane IDs are found across tabs, including after
moves within the workspace. Cleanup retains ownership when closing a pane fails.
An allocation with no recorded pane ID and no live labelled tab is forgotten so cleanup
can proceed. If its labelled tab exists but does not contain exactly one pane, the
command stops and keeps its record for investigation and retry.

## Membership

Pane closure is reported to hub by Herdr events. Hub retires membership and drains
outgoing messages under its normal rules; down never writes membership itself.

## It's working if

- Managed helpers close and the lead stays open.
- Repeating down reports the deployment is already down.

## Where it fits

Use [up](up.md) to create or repair a team and [status](status.md) to inspect ownership.
