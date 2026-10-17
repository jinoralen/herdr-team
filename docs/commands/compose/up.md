# `up`

## What it does

Reconciles `up <file>` with the named deployment in this workspace. Healthy
helpers keep their conversations; hub starts missing helpers in compose-owned panes.

## When to use it

- Run from the user-owned lead pane, either a running agent or an interactive shell.
- Run `up` after editing YAML or to repair missing resources. Shell startup needs `lead.kind`.

## Replacement and recovery

Purpose, model, kind, handle, cwd and context changes replace helpers. Layout changes
move terminals. Hub must finish retiring the old membership and draining outgoing
messages before its handle can be reused; `up` reports this and asks you to retry.
Handles may be reassigned or swapped between helpers in the same deployment:
`up` retires the affected helpers before waiting for reuse. Handles belonging to
another deployment or an unrelated member are refused before pane changes.

Validation and context reads precede pane changes. Failed operations retain ownership
for retry. Recovery finds recorded allocation panes even after they move between tabs;
allocations without a safely identifiable pane remain recorded and stop the command.
An uncertain initial prompt is never repeated into the same conversation.
Compose does not restart an existing lead or own its pane. See [configuration](../../compose.md).

## It's working if

- Helpers receive hub's room guide followed by their purpose.
- A second unchanged `up` creates no agents and submits no helper prompts.

## Where it fits

Use [status](status.md) to see recorded ownership and [down](down.md) to close the
managed helpers while keeping the lead.
