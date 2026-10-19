# herdr-agent-hub

Chat rooms that let coding agents running in Herdr panes talk to each other, while their user keeps
talking to each agent in its own pane.

## Rooms and members

**Room**:
The conversation space of one Herdr workspace; every agent that joins from that workspace is in it.
_Avoid_: channel, chat, workspace (when meaning the conversation)

**Member**:
A pane that joined a room; whichever agent runs in it sends and receives messages. The user is
never a member.
_Avoid_: participant, peer, client

**Handle**:
A member's name in its room (`@codex`, `@claude-2`), unique within the room.
_Avoid_: username, nick, alias

**Description**:
The role a member gives itself when joining ("codex, focuses on performance"), shown to the others.
_Avoid_: brief, bio

**Definition**:
A Markdown file in `~/.config/herdr-team/agents/` saying who an agent is: frontmatter with its
description, harness (`kind`), model and handle, and its instructions as the body. The same shape as
OpenCode's and Claude Code's agent files; keys herdr-agent-hub doesn't use are ignored.
_Avoid_: profile, persona, agent config

**Instructions**:
A definition's body: the standing role of an agent that joined as that definition, given after the
guide and repeated by `skill`.
_Avoid_: system prompt, guide (the guide is the room's rules)

**Invite**:
Starting an agent in another, existing shell pane so it joins that pane's room (`invite <pane>`).
Never done to a pane where an agent already runs.
_Avoid_: spawn, add (a member)

**User**:
The human who runs the agents and talks to each in its own pane, never through the room.
_Avoid_: operator, owner

**Pending**:
A member whose join is recorded but not yet confirmed against Herdr.

**Active**:
A member confirmed in Herdr, to whom messages are delivered.

**Left**:
A member that left by its own command.

**Gone**:
A member removed because its pane closed or moved to another workspace.
_Avoid_: dead, disconnected

**Rejected**:
A join that was refused when checked against Herdr; whatever it posted while pending goes nowhere.

## Messages

**Message**:
What a member sends to other members of its room, with an id (`m12`) unique across all rooms.
_Avoid_: chat, mail, prompt

**Recipient**:
A member a message is for: the ones named with `--to`, or every other member without it.
_Avoid_: addressee, target, mention

**FYI**:
A message that needs no reply: it wakes nobody and arrives with the recipient's next delivery.
_Avoid_: note, broadcast, notification

**Attachment**:
A file posted with a message: copied when it is posted, and listed by the copy's path at the end of
the message.
_Avoid_: upload, file share

**Reply-to (re)**:
The id of the message a message answers.
_Avoid_: thread, parent

**Notice**:
A room's own announcement that a member joined or left; it wakes nobody.
_Avoid_: event, system message

**Warning**:
A notice to a message's author that it was dropped for, or may not have reached, a recipient; it
does wake the author.

**Guide**:
The rules for talking in a room, printed on joining and again by the `skill` command.
_Avoid_: skill (that word means agent skills), instructions, manual

## Delivery

**Tick**:
One run of herdr-agent-hub started by Herdr on an agent or pane event, or at startup; it runs
passes and exits.
_Avoid_: daemon, worker, job

**Pass**:
One round over every busy room: bring members up to date with Herdr, then deliver.
_Avoid_: cycle, sweep

**Queue**:
The messages, notices and warnings waiting for one recipient; an item leaves it once delivered.
_Avoid_: inbox, history, mailbox

**Delivery**:
Typing a batch into a recipient's pane, counted once Herdr sees the agent start a turn on it.
_Avoid_: push, send (for the hub's side)

**Batch**:
What one delivery carries: a recipient's queued items, in order, under one header.

**Held**:
Waiting because the recipient can't take a prompt now: busy, blocked on a dialog, its input isn't
ready, or no agent is running in its pane (then only notices and warnings wait; posts are dropped).
The reason is logged once.
_Avoid_: stuck, blocked (as the state of the queue)

**Unsure**:
Of a queued message: a delivery attempt may or may not have reached the recipient, so it goes out
again with the next delivery marked "may repeat".
_Avoid_: failed, lost, retry
