# `invite` starts agents in panes it is given, and may be run by agents

Starting an agent in another pane moved from `join --agent --pane` to its own command, `invite
<pane>`, so `join` only ever acts on the pane it runs in and an agent reading its help sees nothing
for starting others. `invite` calls Herdr (to start the agent and submit its guide), which agent
commands had never done: `join`, `message` and the rest only touch the database, so they work inside
agent sandboxes. Users and lead agents may run `invite` anyway, because bringing in helpers is what
a lead does, and compose already calls Herdr from a lead's pane; an agent whose sandbox blocks Herdr
gets Herdr's error and its user runs the command.

`invite` touches only the pane named on its command line, and only when it is a shell: a pane where
an agent already runs is refused with the `join --as …` line to paste into it. Typing that request
into a running conversation was considered and left out: it acts on an agent nobody asked, mid-task,
and the room promises (README, quick start) that agents nobody asks to join are never contacted.
