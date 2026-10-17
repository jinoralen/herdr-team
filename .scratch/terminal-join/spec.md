# Terminal join

Design approved in chat: start an agent in the current Herdr shell pane and give it
the join reply as its initial prompt.

- `join --agent <codex|claude|pi> --handle <handle> <description...>` starts an
  interactive agent in the caller's pane, with the current directory and environment.
- Ordinary agent-run `join` keeps working. `--handle` also works without `--agent`
  so the started agent can confirm its membership using the same command.
- An explicit handle is exact: invalid handles and collisions fail without mutation.
  Rejoining the same pane with a different explicit handle fails.
- Before registration, check for an interactive terminal, a live shell pane, a supported
  agent binary on PATH and execve support. Never start a nested agent in a recognized agent pane.
- Register using the normal pending join, then replace the foreground command with the
  agent and pass its guide as one initial-prompt argument. The prompt first asks the agent
  to confirm its join; this recovers if a tick rejected the join before agent detection.
  If confirmation fails, the agent must report the failure and stop.
- Native agent defaults apply; no model configuration, new panes or team management.
- Launch failure can leave a pending membership; retry the same command in the same pane.
- Verify exact handle allocation and collisions, startup validation without state mutation,
  same-pane process handoff, prompt/environment preservation, and existing join behavior.

This is independent of the compose worktree, whose merge conflicts remain untouched.

## Target pane startup (approved in chat)

- `--pane <id>` with `--agent` starts in an existing shell pane and returns to the
  caller. Pane creation, layout, ownership and cleanup stay with compose or the user.
- The target's live workspace supplies its room. A noninteractive caller is allowed;
  explicitly selecting the caller pane uses the existing interactive process handoff.
- Refuse recognized agents in the target and reserve the exact handle before startup.
- Use Herdr's `agent start --pane`, validate the returned and live terminal identities,
  recover a pending join rejected during startup, and confirm membership in a transaction.
- Submit the guide once through Herdr's confirmed prompt operation. Report success only
  if membership is still active afterwards. Never retry startup or guide submission.
- Failures after startup begins may leave an agent, membership or submitted prompt;
  report the uncertainty and tell the caller to inspect the pane and room before retrying.
- Verify target-room selection, caller preservation, handle collision preflight,
  occupied/missing panes, startup rejection recovery, changed targets and uncertain outcomes.

## Initial task (approved in chat)

- `--prompt <text>` with `--agent` appends a user task after the guide in either startup mode.
  Without it, the agent waits for a task. Reject it without `--agent`.
- Keep the short membership description separate; the task is not shown to peers.
- Preserve multiline text and shell metacharacters, strip terminal controls, reject empty tasks,
  and cap tasks at 80 KB before side effects. Cap the complete startup prompt at 100 KB.
- In the current pane, membership confirmation precedes task execution; in another pane,
  confirm membership before submitting guide and task together through Herdr.

## Named description (requested in chat)

- Add `--description <text>` for a consistent named-option interface in all join modes.
- Preserve the positional description for compatibility. Require one form and reject both
  forms together before membership changes or startup.
