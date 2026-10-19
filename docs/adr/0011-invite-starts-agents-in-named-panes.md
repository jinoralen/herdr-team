# `invite` starts every agent, and may be run by agents

Starting an agent is `invite`'s job alone, so `join` only ever makes the agent running it a member
and never calls Herdr. `invite reviewer` starts the agent in the current shell pane, handing it the
terminal; `invite reviewer --pane w1:p3` starts it in another existing shell pane and returns once
it is a member and its guide is submitted. An agent reading `join`'s help sees nothing for starting
others. `invite` calls Herdr (to start the agent and submit its guide), which agent commands never
do: `join`, `message` and the rest only touch the database, so they work inside agent sandboxes.
Users and lead agents may run `invite` anyway, because bringing in helpers is what a lead does, and
compose already calls Herdr from a lead's pane; an agent whose sandbox blocks Herdr gets Herdr's
error and its user runs the command.

`invite` touches only the current pane or the one named with `--pane`, and only when it is a shell:
a pane where an agent already runs is refused with the `join <agent>` line to paste into it. Typing
that request into a running conversation was considered and left out: it acts on an agent nobody
asked, mid-task, and the room promises (README, quick start) that agents nobody asks to join are
never contacted.

## History

First `join --agent --pane`, then `invite <pane>` beside `join --agent` for the current pane. Both
starts moved into `invite`, with the pane as `--pane`, when the CLI was split by audience
(ADR 0012).
