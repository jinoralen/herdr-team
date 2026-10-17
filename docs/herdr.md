# What herdr-agent-hub relies on from Herdr

The Herdr behaviour the code depends on, checked against Herdr 0.9.5. Confirm anything else with
`herdr <command> --help` before building on it. The client is `src/herdr/client.ts`; the shapes it
accepts are `src/herdr/types.ts`.

## Events that run a tick

`herdr-plugin.toml` runs `dist/herdr-agent-hub tick` on startup and on `pane.agent_status_changed`,
`pane.agent_detected`, `pane.closed` and `pane.exited`. These are the only wake-ups: nothing is
delivered between them. `herdr plugin link` doesn't build; `herdr plugin install` runs the `[[build]]`
steps. A tick's output goes to `herdr plugin log list --plugin herdr-agent-hub`.

## Output

Every command prints JSON: `{"result": …}` on success, `{"error": {"code", "message"}}` on failure
(on stderr, sometimes stdout), with a non-zero exit. Branch on `code`, never on `message`.

## Agents

- `herdr agent list` / `herdr agent get <pane>`: `pane_id`, `terminal_id`, `agent` (kind; null if
  not recognized), `agent_status` (`idle`, `working`, `blocked`, `done`, `unknown`),
  `interactive_ready`, `agent_session.value`. `get` fails with `agent_not_found` for an unknown pane.
- `agent_session` may appear some time after the agent is detected; a new value in the same terminal
  is a new conversation.
- Only agents Herdr recognizes can join; `agent` is null for a plain shell.

## Prompting

`herdr agent prompt <pane> <text> --wait --until working --until blocked --timeout 20000`:

- Rejected with `agent_blocked` before anything is typed if the agent is blocked on a dialog.
- From a non-working state it needs a working or blocked state within 5000 ms, else
  `agent_prompt_stalled`: the text **was** submitted but no turn started.
- `timeout` (Herdr's, or the client's 30 s kill) means the outcome is unknown.
- It accepts a prompt for a working agent too, and doesn't track turns; the hub checks state first.
- The text is one argv entry: at most 128 KiB on Linux, so deliveries are capped at 100 KB.

Which of these mean "nothing was typed" decides re-sending: see `docs/adr/0006-no-unmarked-resend.md`.

## Panes and IDs

- `HERDR_ENV=1`, `HERDR_PANE_ID` and `HERDR_WORKSPACE_ID` are set in each pane's environment when its
  process starts, and never change for that process.
- Closed tab and pane IDs are not reused. A moved pane gets a new workspace-qualified ID; its
  process keeps the old one in its environment, so the hub follows agents by `terminal_id`.
- Workspace IDs are Herdr's; one could in principle be reused for a new workspace.
