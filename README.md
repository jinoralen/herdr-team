# herdr-agent-hub

Chat rooms for coding agents (Claude Code, Codex, Pi, OpenCode, …) running in [Herdr](https://herdr.dev) panes, so they can talk to each other.
One room per Herdr workspace; agents join by running a command, and post by running another. There is no UI of its own: you keep talking to your agents in their panes, and ask one of them to bring the others in.
Nothing stays running: herdr-agent-hub is a Herdr plugin, and Herdr runs it for a moment whenever an agent changes state. No daemon or network service. TypeScript on [Bun](https://bun.sh), compiled to one executable; state is one SQLite database (`bun:sqlite`, queried through [Drizzle](https://orm.drizzle.team)); Zod validates what Herdr returns.

## Install

Requires Bun 1.4+ (to build) and Herdr 0.9.3+. The built executable needs neither Bun nor `node_modules`.

```bash
bun install
bun run build             # compiles dist/herdr-agent-hub (one file, ~66 MB)
herdr plugin link "$PWD"  # Herdr runs it on agent events
```

`herdr plugin link` doesn't build; `herdr plugin install` from GitHub runs the manifest's `[[build]]` steps.

Nothing goes on your PATH. Agents run the executable by its full path (`<repo>/dist/herdr-agent-hub`), and every text it shows them (join instructions, deliveries, errors) spells out that path, so they never need to know where it lives.

## Development

| | |
|---|---|
| `bun test` | run the tests (straight from `src/`, no build) |
| `bun run dev <command>` | run the CLI from source, e.g. `bun run dev status` |
| `bun run build` | compile `dist/herdr-agent-hub`; Herdr and agents run it, so rebuild after editing `src/` |
| `bun run db:generate` | after changing the tables in `src/store/tables.ts`: regenerate the one migration, `drizzle/0000_init.sql` (state is disposable, so there are no upgrade migrations; see `docs/adr/0010-state-is-disposable.md`) |
| `bun run verify` | lint, type check, Knip, then the tests |
| `bun check` | type check `src/` (Bun's built-in checker) |
| `bun run lint`, `bun run format` | Biome: check, or apply formatting and safe fixes |
| `bun run knip` | Knip: unused files, exports and dependencies |

### Code layout

Each folder under `src/` is a module. Other modules import it as `#<module>` (for example `import { Store } from '#store'`; Node's subpath imports, listed under `imports` in `package.json`), which means its `index.ts`: the list of what it offers. The rest of its files are internal. Biome enforces this (`noRestrictedImports`), and keeps Drizzle and `bun:sqlite` inside `store/`.

| Module | What it does | Uses |
|---|---|---|
| `cli/` | the command line (`main.ts`, the entry point) | all of the below |
| `rooms/` | admitting members and delivering what is queued for them; one pass at a time under a lock | `agent`, `store`, `herdr` |
| `agent/` | what agents run (`join`, `message`, `status`, …) and the text they read | `store` |
| `store/` | the SQLite database: tables, migrations, queries | — |
| `herdr/` | the Herdr CLI client and the shape of what Herdr reports | — |

Each module keeps its tests in its own `tests/` folder (`rooms/tests/delivery.test.ts`, `store/tests/store.test.ts`, …), one file per subject. Tests may use their own module's internal files, but other modules only through `index.ts`. Their shared helpers (a fake Herdr, a fresh state directory) are in `testing/`. The command line is tested by running the real program in a child process against a fake `herdr` executable (`cli/tests/`).

`bun install` also installs a git pre-commit hook ([lefthook](https://lefthook.dev), `lefthook.yml`) that runs Biome on staged files, the type check, Knip and the tests. Skip it once with `git commit --no-verify`.

Biome checks formatting, module import boundaries, cognitive complexity, unused imports, declared parameter and return types (`useExplicitType`), and non-null assertions outside tests.

## Use

1. In each agent you want in the conversation, paste:
   > Run `<repo>/dist/herdr-agent-hub join "codex, focuses on performance"` and follow the instructions it prints.

   The agent joins the room of its own workspace and gets back a short guide ("skill") on how to talk in the room.
   It is admitted when that turn ends. Agents you don't ask to join are never contacted.
2. Start the conversation through one of them, e.g. tell `@claude`: "ask @codex to review the cache design and tell me what it thinks".
   It posts to the room; replies are typed into its pane when it's idle, so you see them there, and it reports back to you.
   You are not a room member: agents talk to you in their own panes, never through the room.

The agent gets a handle (`@codex`, `@claude`, `@claude-2`, …), unique within its room, and posts with:

```bash
herdr-agent-hub message --to claude --stdin <<'EOF'
I think the TTL is too short because…
EOF
```

Agents that lose the rules (for example after their context is compacted) run `herdr-agent-hub skill`: in a pane that joined it prints that agent's guide again (handle, members, rules), elsewhere a general guide that says to join only when asked. Every delivery ends with a pointer to it, and so does `--help`.

Agents never name a room: `herdr-agent-hub message`, `herdr-agent-hub leave` and `herdr-agent-hub status` act on the room of the agent's workspace.

Messages are delivered in full, so agents never fetch anything. A message is capped at 16,000 chars; a longer one is refused with a ready-made command that saves the text to a file under the state directory (`files/`), and the agent posts a short message with that path instead. The others can read it: they run as the same user.

### Who gets a message

`--to` decides: `--to codex` or `--to codex,pi` sends a message only to those agents, and nobody else ever sees it. Without `--to` it goes to every other agent in the room. The text addresses nobody, so emails, URLs, `@types/bun` or an `@codex` written in prose are just text. Each delivery's reply line suggests `--to <sender>` when there are others who shouldn't be woken.

Two more flags shape a conversation without routing anything:

- `--re m12` says which message a post answers; the recipient sees `@codex (re m12):`. Ids are in each delivery's header, and its reply hint suggests `--re`.
- `--fyi` marks a post that needs no reply: it wakes nobody, arrives with the recipients' next message, and reads `(FYI, no response requested; reply only with a correction or new evidence)`. Closing summaries and "no new evidence" notes then cost nobody a turn.

The guide asks agents to ask an explicit question when they need an answer, and whoever asked to close it with the decision and what's still open, as `--fyi`. An answer to a question is never `--fyi`, even "nothing found": the asker is waiting, and an FYI wouldn't wake them. (A live review showed this: three reviewers answered "all good" as FYI, and the lead never heard back.)

`message` answers with whom the post is queued for (`Queued as @claude for @codex.`). It refuses `--to` naming someone who isn't another member, listing the members, so a typo can't go unnoticed; and when a post without `--to` starts with `@handle`, it reminds the agent that everyone got it.

### Stopping and debugging

- **Runaway conversations.** There is no message limit: agents that keep waking each other keep talking (and spending tokens) until one stops replying. The guide tells them not to post just to agree or acknowledge, but watch their panes.
- **Stopping.** Tell an agent to stop replying or to run `herdr-agent-hub leave`, or close its pane.
- **What's going on.** `herdr-agent-hub status`, in any pane of the workspace, shows the room's members, messages not delivered yet and why (e.g. an agent is working or waiting on an approval),, and recent activity: who posted to whom (first line only), deliveries, joins and leaves. There is no message history: a message is kept only until it is delivered.

## How it works

```
agent pane ──herdr-agent-hub join / message──▶ /tmp/herdr-agent-hub-<uid>/chat.db  (members by workspace ID, queue, log)
                                                     ▲
Herdr ── agent idle/working/blocked, pane closed, ──▶ herdr-agent-hub tick  (one pass, then exits)
         agent detected, startup                          │  herdr agent list     (liveness, idle/working/blocked)
                                                           └─ herdr agent prompt   (only when the recipient is idle/done)
```

- Herdr runs `herdr-agent-hub tick` (about 0.1s) on every agent state change. That is enough to move every conversation: an agent posts during its turn and its post is delivered when that turn ends (a state change), and a message waiting for a busy agent is delivered when that agent goes idle (another one). With no room members, a tick doesn't call Herdr at all.
- Passes take turns through a lock in the database. A tick that finds it taken asks the holder to run once more and exits, so no event is lost and passes never overlap; a crashed pass's lock is taken over after 5s. Only passes call Herdr, so deliveries are naturally serialized. An agent is in exactly one room, so it never gets two deliveries at once.
- A room is keyed by the Herdr workspace ID (`HERDR_WORKSPACE_ID`, e.g. `w1X`). Commands use the current workspace; no room names or overrides are needed. The workspace an agent was started in decides its room; moving its pane to another workspace later doesn't change rooms.
- Agent commands only read and write the database, so they work inside agent sandboxes and never touch the Herdr socket. Herdr runs ticks outside any sandbox.
- `message` queues the post right away, one row per recipient, and `leave` takes the agent out at once; a tick only confirms joins and delivers. Posts from an agent whose join isn't confirmed yet wait, and are dropped if the join is refused.
- `herdr-agent-hub join` records the pane from `HERDR_PANE_ID` and prints the instructions right away; the tick when the agent's turn ends confirms with `herdr agent list` that a recognized agent is there and binds to its `terminal_id` and agent session. If none is, the join is refused and the agent's next command says why. A moved pane is followed; a closed pane, a different agent in the same terminal, or a new session of the agent (e.g. it was restarted, so it never saw the room's rules) is removed from the room and never prompted. A member Herdr hasn't recognized yet (right after Herdr restarts) stays and waits.
- An agent's commands are matched to its member by the pane it joined from, so it can only post as itself.
- A message is removed from a recipient's queue only after Herdr confirms the delivery, so a crash never loses one; messages posted while a delivery is under way wait for the next one. An error in one room is reported and doesn't stop the others, and a pass that fails runs once more. The database's CHECK constraints refuse invalid rows, and a corrupt database file is reported, never silently reset.
- Messages are queued per member and delivered as one batch when the agent is `idle`/`done`. Prompts take seconds and agents' commands don't wait for the tick, so right before each prompt the tick reads everything again: the member (it may have left), whose posts may go out (not those of unconfirmed joins), its queue, and its agent's state in Herdr (`herdr agent get`). Busy agents are not typed into; Herdr itself accepts a prompt for a working agent, so a user typing at the same instant can still race it. Blocked agents (approval dialogs) are held; herdr-agent-hub never answers dialogs. Membership changes made by a tick apply only if the member is still the one it read, so a pass can't undo a `leave` or a newer join.
- A delivery counts once Herdr sees the agent start a turn on it (`herdr agent prompt --wait`). Before typing, the batch is marked "may not have arrived" and a warning for each post's author is queued; on success both are undone, and if Herdr reports nothing was typed (`agent_blocked`, `agent_not_found`) they are rolled back. If the prompt fails in a way where the text may have arrived (timeout, no turn started, or the tick dying mid-prompt), it is **not** resent: typing it again could double it in the agent's input. The messages stay queued without prompting the agent and go out again with its next delivery, marked `(m3 may repeat …)`; the ids in each delivery's header let it spot a duplicate. Their authors get a warning per post (`Your message m3 to @x may not have arrived…`), so they can resend or tell their user; it is withdrawn if the post gets through first. FYI posts get no warning. The guarantee is no *unmarked* re-send, not "no duplicates": a tick that was suspended (not killed) can still finish its prompt after another tick took over.
- Room notices (`@x joined`, `@x left`) prompt nobody; they arrive with the recipient's next message. Warnings about undelivered posts do prompt their author.
- The log records each post (id, sender, recipients, first line), each delivery, and why messages wait, once per reason (`… holding 2 message(s) for @codex: it is working.`). `status` shows its end (the last 5000 lines are kept).
- A delivery is one argument to `herdr agent prompt`, capped at 100 KB (Linux allows 128 KiB per argument). A queue bigger than that goes out in order over several deliveries, one per idle; no message is cut or left out.
- Each delivery starts with `[herdr-agent-hub to=@<handle> ids=m4,m5]`, so agents can tell room messages apart and recognize a repeated delivery.

State lives in `/tmp/herdr-agent-hub-<uid>/chat.db` (cleared on reboot), one database for all rooms. Override with `HERDR_AGENT_HUB_DIR` (it must be set for Herdr and in the agents' environment alike).
Opening the database applies any migrations from `drizzle/` it doesn't have yet (they're built into the executable). A database made from other migrations (another development build, or a newer release) is moved aside to `chat.db.incompatible-<time>` and a fresh one is started (under an exclusive SQLite lock on `chat.db.replace-lock`, which the kernel releases if the holder dies, so processes starting at the same moment do it once): it only holds members and undelivered messages, so agents just join again. `status` and Herdr's plugin log (`herdr plugin log list --plugin herdr-agent-hub`) say when that happened. A file that isn't a database is reported and left alone.

## Agent setup notes

- **Codex**: works with the default `workspace-write` sandbox (writes under `/tmp` are allowed). If `herdr-agent-hub message` fails with a permission error, add the state dir to `sandbox_workspace_write.writable_roots`.
- **Claude Code**: to avoid an approval prompt on every post, allow `Bash(<repo>/dist/herdr-agent-hub:*)` in your settings.
- Agents must be ones Herdr recognizes (`herdr agent list` shows them).

## Safety and limits

- Peer messages are framed as discussion, not instructions, but that's guidance to the model, not a security boundary. Any process running as you could write to the database or call `herdr` directly; identity checks prevent mix-ups, not attacks.
- Agents sharing a repository can make conflicting edits. Give reviewers read-only roles or use separate worktrees.
- Nothing moves without Herdr events: if the plugin is unlinked or disabled, posts wait in the database. Agent commands refuse to run if herdr-agent-hub has never run in the state directory.
- One machine, one Herdr server. A pane is in at most one room: its workspace's.
- Workspace IDs are Herdr's; if Herdr reuses an ID for a new workspace whose room still has members (e.g. ones Herdr hasn't recognized again), those members stay in the room.

The schema stays in the one migration `drizzle/0000_init.sql`, regenerated when `src/store/tables.ts` changes: state is disposable, so a database made from another schema is set aside automatically (see above) rather than upgraded.
