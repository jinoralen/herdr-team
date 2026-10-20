# What herdr-team relies on from Herdr

The Herdr behaviour the code depends on, checked against Herdr 0.9.5. Confirm anything else with
`herdr <command> --help` before building on it. The client is `packages/herdr/src/client.ts`; the shapes it
accepts are `packages/herdr/src/types.ts`.

## Events that run a tick

`herdr-plugin.toml` runs `dist/herdr-hub tick` (with `--startup` on startup) and on `pane.agent_status_changed`,
`pane.agent_detected`, `pane.closed` and `pane.exited`. These are the only wake-ups: nothing is
delivered between them. `herdr plugin link` doesn't build; `herdr plugin install` runs the `[[build]]`
steps. A tick's output goes to `herdr plugin log list --plugin herdr-team`.

## Output

Every command prints JSON: `{"result": …}` on success, `{"error": {"code", "message"}}` on failure
(on stderr, sometimes stdout), with a non-zero exit. Branch on `code`, never on `message`.

## Agents

- `herdr agent list` / `herdr agent get <pane>`: `pane_id`, `terminal_id`, `agent` (kind; null if
  not recognized), `agent_status` (`idle`, `working`, `blocked`, `done`, `unknown`),
  `interactive_ready`, `agent_session.value`. `get` fails with `agent_not_found` for an unknown pane.
- They only show panes with an agent: once the agent exits, its pane drops out of `agent list` and
  `agent get` fails with `agent_not_found`, as for a closed pane. So ticks read `herdr pane list` /
  `herdr pane get <pane>` instead: the same fields for every open pane, `agent` absent when none is
  recognized, and `pane get` fails with `pane_not_found` once the pane closed. Checked in 0.9.5.
- `agent_session` may appear some time after the agent is detected; a new value in the same terminal
  is a new conversation.
- `invite --pane <pane>` uses `herdr agent start <name> --kind <kind> --pane <pane> --timeout 120000`.
  Optional harness arguments follow `--`, e.g. `-- --model <id>` (checked with the installed CLI).
  Agent names must start with a lowercase letter and contain only lowercase letters, digits,
  hyphens or underscores, up to 32 characters; hub truncates its UUID suffix to fit.
  The pane must be at an interactive shell prompt. Success means the expected agent was detected
  in the same terminal and is ready for input. The client allows 130 seconds for this operation.
  The hub then confirms membership and submits the room guide through `agent prompt`.
- Only agents Herdr recognizes can join; `agent` is null for a plain shell.

## Prompting

`herdr agent prompt <pane> <text> --wait --until working --until blocked --timeout 20000`:

- Rejected with `agent_blocked` before anything is typed if the agent is blocked on a dialog.
- From a non-working state it needs a working or blocked state within 5000 ms, else
  `agent_prompt_stalled`: the text **was** submitted but no turn started.
- `timeout` (Herdr's, or the client's 30 s kill) means the outcome is unknown.
- It accepts a prompt for a working agent too, and doesn't track turns; the hub checks state first.
- It honours the pane's bracketed-paste mode: the text goes in as a paste, then Enter. An ESC in the
  text could end the paste early, so deliveries are stripped of control characters first.
- The text is one argv entry: at most 128 KiB on Linux, so deliveries are capped at 100 KB.

Which of these mean "nothing was typed" decides re-sending: see `docs/adr/0006-no-unmarked-resend.md`.

## Panes and IDs

- `HERDR_ENV=1`, `HERDR_PANE_ID` and `HERDR_WORKSPACE_ID` are set in each pane's environment when its
  process starts, and never change for that process.
- IDs are scoped to one server (one Herdr session): another session, or the next server, can hand
  out the same `w1:p1`. Each session has its own socket (`herdr session list --json` shows
  `socket_path`), and `HERDR_SOCKET_PATH` gives it to every pane and plugin command (checked on a
  pane event in 0.9.5).
- Closed tab and pane IDs are not reused within a server. A pane moved within its workspace (to
  another tab or split) keeps its ID; moved to another workspace, it gets a new workspace-qualified
  ID and keeps its `terminal_id`. Its process keeps the old IDs in its environment.
- Both lists report each pane's `workspace_id` and `tab_id` too.
- Workspace IDs are Herdr's; one could in principle be reused for a new workspace.
- Remote startup requires `workspace_id` from `pane get`; this supplies the target room rather
  than the caller's inherited workspace. The pane and terminal are checked again after startup.
