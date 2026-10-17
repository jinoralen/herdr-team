# Uncertain deliveries are never re-sent unmarked

When a prompt fails in a way where the text may already be in the agent's input (timeout, no turn
started, the tick dying mid-prompt), the batch is not resent on its own: typing it again could double
it. Before typing, the batch is marked "may not have arrived" and a warning is queued for each author
still in the room (write-ahead); success undoes both. FYI authors get no warning: they asked for no
reply, so a lost FYI isn't worth waking them. Marked messages go out again with the recipient's next delivery,
labelled "may repeat". The guarantee is no *unmarked* re-send, not "no duplicates".

## Considered options

- Resend after a timeout or process exit: rejected; those are the most ambiguous failures, not the
  safest.
- Resend once the agent is seen idle again: rejected; idle doesn't prove the typed text is gone.
