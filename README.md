# Herdr Team

## What?

Let your coding agents talk to each other in [Herdr](https://herdr.dev).

Ask Claude to get Codex's opinion, have a reviewer check a design, or bring a team together for a task. You keep talking to each agent in its own pane; herdr-team delivers messages between them.

Each Herdr workspace has its own room. Agents only join when you ask them to. Everything runs locally, with no server to manage.

## Why?

- **I was the relay between agents,** copying one agent's findings into another's pane. Herdr can send text to a pane, but its API is generic and agents sometimes got it wrong. So I built a simple message hub: agents message each other by handle, and each message waits until its recipient is ready.
- **Each model is good at different things.** I wanted a reviewer on a different model than the coder, without being locked into one harness's idea of a subagent. Claude, Codex and pi agents can all join the same room.
- **I kept rebuilding the same setups.** A coder plus a reviewer, or three reviewers each checking a PR from a different angle before merge. Now each setup is a file I start with one command, in any project.

## How?

The project consists of two CLI apps. The examples below assume you've [installed](#install) the plugin and [added the commands to PATH](#add-the-commands-to-path-zsh).

### `herdr-hub`

The core of the plugin: it passes messages between agents in different Herdr panes and wraps Herdr's API to make defining and starting agents simpler.

For example, a coder and a reviewer talking to each other:

`~/.config/herdr-team/agents/coder.md`:

```markdown
---
description: writes code for the user's tasks
kind: claude
---

Implement what the user asks. When done, send your diff to @reviewer and fix what it finds.
```

`~/.config/herdr-team/agents/reviewer.md`:

```markdown
---
description: reviews correctness, read-only
kind: codex
---

Review changes when asked: bugs, edge cases, missing tests. Give file:line for each
finding. Review only; do not edit files.
```

```bash
# in one shell pane, in any project
herdr-hub invite coder

# in a second shell pane, same workspace
herdr-hub invite reviewer

# in @coder's pane: "Add input validation to the signup form."
# @coder implements it, @reviewer reviews it, @coder fixes the findings
```

### `herdr-compose`

Builds on `herdr-hub` with Docker Compose-style files that define reusable agent teams.

For example, a review by several agents, combined into one list:

`~/.config/herdr-team/agents/lead.md`:

```markdown
---
description: coordinates the reviewers
kind: claude
---

Split the review between the reviewers and give the user one combined list of findings.
```

`~/.config/herdr-team/agents/architect.md`:

```markdown
---
description: reviews architecture, read-only
kind: claude
---

Review module boundaries, coupling, and whether the change fits the design. Review only;
do not edit files.
```

`~/.config/herdr-team/teams/review.yaml`:

```yaml
name: review
lead:
  use: lead
tabs:
  reviewers:
    layout: columns
agents:
  architect:
    use: architect
    tab: reviewers
  reviewer:
    use: reviewer # reviewer.md from the herdr-hub example above
    tab: reviewers
```

```bash
# in a shell pane, in any project: @lead, @architect and @reviewer, each in its own pane
herdr-compose up review

# in @lead's pane: "Review this branch against main."

# when you're done: close all the team's agents and panes
herdr-compose down
```

## Install

Requires Herdr 0.9.3+ and Bun 1.4+ on macOS or Linux. Install from GitHub:

```bash
herdr plugin install jinoralen/herdr-team
```

Herdr downloads the plugin and builds its commands. Bun is needed to install and update; the built commands run without it. Your coding agents must already be installed and recognized by Herdr.

See [update and uninstall](docs/setup.md#update-and-uninstall). To build from a local checkout instead, see [development setup](docs/development.md#get-started).

### Add the commands to PATH (zsh)

For yourself, put both commands on PATH with Tab completion, in Herdr panes only. Add to `~/.zshrc`:

```zsh
if [[ -n $HERDR_ENV && $(${HERDR_BIN_PATH:-herdr} plugin list --plugin herdr-team --json 2>/dev/null) =~ '"plugin_root":"([^"]+)"' ]]; then
  source $match[1]/shell/init.zsh
fi
```

This enables `herdr-hub`, `herdr-compose`, and Tab completion inside Herdr. Open a new shell pane after saving. It works with linked and installed plugins, including after updates.

## Agents that are already running

To bring in an agent you already have open, paste this into its pane:

> Run `herdr-hub join -d "helps with code review"` and follow the instructions it prints.

Once its turn finishes, it joins the room and learns the other members' handles, such as `@claude` and `@codex`. Without the PATH setup, use `<plugin_root>/dist/herdr-hub`, where `plugin_root` comes from `herdr plugin list --plugin herdr-team --json`.

**To stop a conversation**, tell an agent to stop replying, ask it to run `leave`, or close its pane. Agents can keep waking each other and spending tokens until one stops.

## Commands

Agents use the full path to `dist/herdr-hub`. For short commands and Tab completion in your own shell, use the [PATH setup above](#add-the-commands-to-path-zsh).

| Command                                         | Use it to…                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`join [agent]`](docs/commands/hub/join.md)     | Have a running agent join the room, optionally using a saved definition.                          |
| [`message`](docs/commands/hub/message.md)       | Send a message or attach files. `--to` selects recipients; without it, everyone else receives it. |
| [`guide`](docs/commands/hub/guide.md)           | Remind an agent how to use the room.                                                              |
| [`leave`](docs/commands/hub/leave.md)           | Have an agent leave the conversation.                                                             |
| [`invite [agent]`](docs/commands/hub/invite.md) | Start a new agent in a shell pane and bring it into the room.                                     |
| [`agents`](docs/commands/hub/agents.md)         | List saved agent definitions.                                                                     |
| [`status`](docs/commands/hub/status.md)         | See who's in the room and why messages may be waiting.                                            |
| [`tick`](docs/commands/hub/tick.md)             | Process membership and deliveries. Herdr runs this automatically.                                 |

## Reuse agents and teams

Save an agent's role, model, and instructions as a Markdown definition in `~/.config/herdr-team/agents/`. Then ask a running agent to `join reviewer`, or start one from a shell with `invite reviewer`. See [agent definitions](docs/commands/hub/join.md#joining-as-a-definition).

For a repeatable team with its own pane layout, use [compose](docs/compose.md) and the [example team](examples/team.yaml).

| Command                                                      | Use it to…                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`herdr-compose up [team]`](docs/commands/compose/up.md)     | Start or update a team in separate lead and helper panes. Preview with `--dry-run`. |
| [`herdr-compose down [team]`](docs/commands/compose/down.md) | Close the team's lead and helper panes.                                             |
| [`herdr-compose status`](docs/commands/compose/status.md)    | See the teams running in this workspace.                                            |
| [`herdr-compose teams`](docs/commands/compose/teams.md)      | List saved team definitions.                                                        |

## More information

- [Setup and troubleshooting](docs/setup.md): shell completion, agent permissions, state location, and limits.
- [Development](docs/development.md): build, test, and contribute.
- [Design decisions](docs/adr/) and [glossary](GLOSSARY.md): how the pieces fit together.

The code is organized into five packages: [hub](packages/hub/) handles rooms and messages, [compose](packages/compose/) builds teams, [herdr](packages/herdr/) talks to Herdr, [agents](packages/agents/) reads definitions, and [terminal](packages/terminal/) handles terminal text. See the [code layout](docs/development.md#code-layout) for details.

Licensed under the [MIT License](LICENSE).
