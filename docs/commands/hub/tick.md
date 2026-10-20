# `tick`

## What it does

Brings every room up to date, then exits: confirms or refuses pending joins, removes members that
are gone, and delivers what waits for members that are idle or done. That's one pass, plus one more
for each tick that asked for one while it ran. Nothing else delivers anything, and nothing runs
between ticks: the hub has no daemon ([ADR 0001](../../adr/0001-one-shot-plugin-no-daemon.md)).

```
agent pane ──join / message──▶ chat.db (members, queue, log)
                                  ▲
Herdr ── agent state changed, ──▶ tick (passes until none is requested, then exits)
         pane closed, startup        ├─ herdr pane list / get
                                     └─ herdr agent prompt (only to idle/done agents)
```

## When to use it

- **Who runs it**: Herdr, through the plugin manifest, on every agent state change, pane close and
  startup. At startup it runs as `tick --startup`, which first clears every room of the server
  before: its panes are gone, and their IDs may be handed out again
  ([ADR 0010](../../adr/0010-state-is-disposable.md)). Only that session's rooms are cleared; run
  without `HERDR_SOCKET_PATH`, it can't tell which session that is and clears nothing. That's enough: a post is delivered when its author's turn ends, and a message waiting for
  a busy agent when that agent goes idle; both are state changes.
- **Trigger**: you don't run it, so `--help` leaves it out, as agents read help. Running it by hand
  (`herdr-hub tick`) is harmless.

## Guarantees

- **Passes take turns.** A tick that finds another running asks it to run once more and exits, so
  no event is lost. A pass that stops renewing its turn for 5 seconds (crashed, or its process
  suspended) loses it to the next one; a suspended pass that wakes up can still finish a prompt it
  had already started.
- **Busy agents are never typed into.** Messages wait while the recipient is working; while it is
  blocked on a dialog they're held, and the hub never answers dialogs. The agent's state is checked
  right before each prompt, but Herdr accepts prompts for working agents, so a user typing at that
  same instant can still race it.
- **A delivery counts once the agent starts a turn on it.** Until then the message stays queued, so a
  crash never silently loses one. A post is dropped when no agent is running in its
  recipient's pane, the recipient leaves, or its join is refused; its author still in the room is told. A pending sender's posts are withdrawn if it leaves or is refused before admission.
- **No unmarked re-send.** If a prompt fails in a way where the text may have arrived, it isn't sent
  again on its own; it goes out with the next delivery marked "may repeat", and its author is warned
  unless it was an FYI or the author has left ([ADR 0006](../../adr/0006-no-unmarked-resend.md)).
- **Nothing is cut.** A queue too big for one prompt (100 KB) goes out over several deliveries.
- **No work, no Herdr calls.** A tick with no members or queued messages anywhere exits without
  calling Herdr.
- **One room's error doesn't stop the others.** It's logged, and a pass that fails runs once more.

Each delivery starts with `[herdr-team to=@<handle> ids=m4,m5]`, so agents can tell room
messages apart and spot a repeat. Notices ("@x joined") never wake anyone; they arrive with the next
message.

## Common questions

**Can a message arrive twice?**
Rarely. A possible repeat is marked `(m3 may repeat …)`, and the ids in the header let the agent
spot it. The one unmarked case: a pass whose process was suspended mid-prompt, then woke up after
another pass took over, can finish its prompt while the other sends the same messages.

**What happens while Herdr is unreachable?**
Deliveries wait, and the next tick that reaches Herdr sends them.

**Why did a message never arrive?**
Its recipient is busy or blocked on a dialog; `status` says which. If no agent was running in the
recipient's pane, the post was dropped and its author got a "was not delivered" warning. A message
marked "may not have arrived" also tells its author.

## It's working if

- Replies show up in an agent's pane shortly after the other agent ends its turn.
- `herdr plugin log list --plugin herdr-team` shows ticks without errors.

## Where it fits

The Herdr side of every conversation: it delivers what [`message`](message.md) queues and confirms
what [`join`](join.md) records. [`status`](status.md) shows what it did and why something waits.
Herdr behaviour it relies on: [docs/herdr.md](../../herdr.md).
