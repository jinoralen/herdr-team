# `teams`

## What it does

Lists the team files in `~/.config/herdr-team/teams/`, the ones [up](up.md) finds by name, each
read as `up` would read it from the current folder: its definitions resolved, working folders and
shared files checked. A team that can't be used is listed with what is wrong with it. It only
reads files, so it needs no Herdr and no hub.

## When to use it

- **Who runs it**: the user or a lead agent, from any shell.
- **Trigger**: before `up <team>`, to see the names and catch a broken team or definition. For the
  definitions alone, use hub's [`agents`](../hub/agents.md); for what is deployed now, use
  [`status`](status.md).
- `--json` prints each team's deployment name and agents, with `problem` for the broken ones.

## It's working if

- Every team file in the folder is listed, with its deployment name and agents or a reason.

## Where it fits

Pick a team here, preview it with `up --dry-run`, then [up](up.md). Hub's
[`agents`](../hub/agents.md) lists the definitions teams use.
