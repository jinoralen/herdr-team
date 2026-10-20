# `up`

## What it does

Reconciles a team with its deployment in this workspace. Healthy helpers keep their
conversations; hub starts missing helpers in compose-owned panes. `up review` names a team in
`~/.config/herdr-team/teams/`, `up ./team.yaml` a file, and `up` alone reads `./herdr-team.yaml`
in the current folder (never a parent folder's).

## When to use it

- Run from the user-owned lead pane, either a running agent or an interactive shell.
- Run `up` after editing YAML or to repair missing resources. Shell startup needs `lead.use`, a definition with a `kind`.
- Run `up --dry-run` first when a change may replace helpers: replacing one ends its conversation.

## Seeing what it will do

| Option | Behavior |
|---|---|
| `--dry-run` | Print what `up` would start, replace (and why: its definition, handle, working folder, prompt, or the team's shared prompt, files or lead changed, or its conversation is gone), move and close; change nothing. Works from a script too, where `up` itself needs an agent or an interactive shell in the pane |
| `--json` | Print the deployment, the changes and the usual output as JSON, with or without `--dry-run`. Never hands the terminal to a lead: from a shell pane, `up --json` is refused before changing anything |

## Replacement and recovery

Definition edits (kind, model, description, instructions), and purpose, handle, cwd and context
changes, replace helpers. Layout changes
move terminals. Hub must finish retiring the old membership and draining outgoing
messages before its handle can be reused; `up` reports this, exits with 75 (`EX_TEMPFAIL`), and
asks you to retry after a tick. A handle held by an unrelated live member exits with 1.
Handles may be reassigned or swapped between helpers in the same deployment:
`up` retires the affected helpers before waiting for reuse. Handles belonging to
another deployment or an unrelated member are refused before pane changes.

Validation and context reads precede pane changes. Failed operations retain ownership
for retry. Recovery finds recorded allocation panes even after they move between tabs;
allocations without a safely identifiable pane remain recorded and stop the command.
An uncertain initial prompt is never repeated into the same conversation.
Compose does not restart an existing lead or own its pane. See [configuration](../../compose.md).

## It's working if

- Helpers receive hub's room guide, their definition's instructions, then their purpose; peers see
  the definition's description.
- A second unchanged `up` creates no agents and submits no helper prompts.

## Where it fits

Use [status](status.md) to see recorded ownership and [down](down.md) to close the
managed helpers while keeping the lead.
