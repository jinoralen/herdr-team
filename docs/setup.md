# Setup and troubleshooting

## Shell commands and completion

To put `herdr-hub` and `herdr-compose` on PATH with Tab completion, follow the [README setup](../README.md#add-the-commands-to-path-zsh). Shells outside Herdr are untouched; see [ADR 0013](adr/0013-path-and-completion-only-in-herdr-shells.md).

## Agent permissions

- **Codex**: works with the default `workspace-write` sandbox (writes under `/tmp` are allowed). If `herdr-hub message` fails with a permission error, add the state dir to `sandbox_workspace_write.writable_roots`.
- **Claude Code**: to avoid an approval prompt on every post, allow `Bash(<repo>/dist/herdr-hub:*)` in your settings.
- Agents must be ones Herdr recognizes (`herdr agent list` shows them).
- Agent commands only read and write the state database, so they work inside agent sandboxes.
  Ticks and `invite` call Herdr, so run them outside a sandbox
  ([ADR 0011](adr/0011-invite-starts-agents-in-named-panes.md)).

## State location

Room state lives in `/tmp/herdr-team-<uid>/hub/chat.db`; compose keeps its database in the adjacent `compose/` directory. The default location is cleared on reboot.

To change it, set `HERDR_TEAM_STATE_DIR` to the same absolute path in both Herdr's and the agents' environments. Relative paths are refused.

Hub state is disposable. If a build uses a different schema, the old database is moved aside and agents must join again. `status` and Herdr's plugin log report the reset. See [the state policy](adr/0010-state-is-disposable.md). Compose preserves its ownership database on an incompatible schema; see [compose](compose.md).

## Limits

- Peer messages are framed as discussion, not instructions, but that's guidance to the model, not a security boundary. Any process running as you could write to the database or call `herdr` directly; identity checks prevent mix-ups, not attacks.
- Agents sharing a repository can make conflicting edits. Give reviewers read-only roles or use separate worktrees.
- Nothing moves without Herdr events: if the plugin is unlinked or disabled, posts wait in the database. `join` and `message` refuse to run if herdr-team has never run in the state directory.
- One machine, one Herdr server. A pane is in at most one room: its workspace's.
- Workspace IDs are Herdr's; if Herdr reuses an ID for a new workspace whose room still has members (e.g. ones Herdr hasn't recognized again), those members stay in the room.

