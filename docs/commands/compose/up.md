# `up`

## What it does

Reconciles a team with its deployment in this workspace. The lead and helpers run in separate
compose-owned panes; the caller keeps its terminal. Healthy agents keep their conversations. `up review` names a team in
`~/.config/herdr-team/teams/`, `up ./team.yaml` a file, and `up` alone reads `./herdr-team.yaml`
in the current folder (never a parent folder's).

## When to use it

- Run from a separate shell or agent pane in Herdr. Managed lead and helper panes cannot run lifecycle commands.
- Run `up` after editing YAML or to repair missing resources. Every team needs `lead.use`, a definition with a `kind`.
- Run `up --dry-run` first when a change may replace helpers: replacing one ends its conversation.

## Seeing what it will do

| Option | Behavior |
|---|---|
| `--dry-run` | Print what `up` would start, replace (and why: its definition, handle, working folder, prompt, or the team's shared prompt, files or lead changed, or its conversation is gone), move and close; change nothing. Works from scripts in Herdr too |
| `--json` | Print the deployment, the changes and the usual output as JSON, with or without `--dry-run`. Works from shell panes and scripts in Herdr; returns after starting the managed agents |

## Replacement and recovery

Definition edits (kind, model, description, instructions), and purpose, handle, cwd and context
changes replace managed agents, including the lead. Layout changes
move terminals. Hub must finish retiring the old membership and draining outgoing
messages before its handle can be reused; `up` reports this, exits with 75 (`EX_TEMPFAIL`), and
asks you to retry after a tick. Join and leave notices travel with the recipient's next message, so send that recipient a message if notices still reserve the handle. A handle held by an unrelated live member exits with 1. The
lead's handle is checked the same way: held from another open pane exits with 1, from a closed
one with 75.
Handles may be reassigned or swapped between helpers in the same deployment:
`up` retires the affected helpers before waiting for reuse. Handles belonging to
another deployment or an unrelated member are refused before pane changes.

Validation and context reads precede pane changes. Failed operations retain ownership
for retry. Recovery finds recorded allocation panes even after they move between tabs;
allocations with no recorded pane and no live labelled tab are forgotten so retry can proceed.
A labelled tab without exactly one pane remains recorded and stops the command.
An uncertain initial prompt is never repeated into the same conversation.
New helpers start together once every pane is laid out, so `up` waits about as long as its
slowest agent. A helper that fails to start doesn't stop the others: they are recorded ready,
`up` reports every failure, and a retry replaces only the uncertain helpers.
The lead uses the same ownership, replacement and recovery rules as helpers. See [configuration](../../compose.md).

## It's working if

- Helpers receive hub's room guide, their definition's instructions, then their purpose; peers see
  the definition's description.
- A second unchanged `up` creates no agents and submits no helper prompts.

## Where it fits

Use [status](status.md) to see recorded ownership and [down](down.md) to close the
managed lead and helpers.
