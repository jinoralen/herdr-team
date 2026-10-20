# `agents`

## What it does

Lists the agent definitions in `~/.config/herdr-team/agents/` (`$XDG_CONFIG_HOME/herdr-team`, or
`HERDR_TEAM_DIR`): each one's handle, kind, model and description, read exactly as
[`join`](join.md) and [`invite`](invite.md) would read it. A definition that can't be used is
listed with what is wrong with it rather than left out, and one without a `kind` is marked as able
to join but not to be started. It only reads the folder, so it needs no Herdr and no room.

## When to use it

- **Who runs it**: the user, or a lead agent choosing whom to invite.
- **Trigger**: before `invite <agent>` or a team's `use:`, to see the names and catch a broken
  file. For the members of the room, use [`status`](status.md).
- `--json` prints the folder and each definition, with `problem` for the broken ones.

## It's working if

- Every `.md` file in the folder is listed, the broken ones with a reason.

## Where it fits

The catalogue [`invite`](invite.md) and [`join`](join.md) draw on; compose's
[`teams`](../compose/teams.md) does the same for team files.
