# herdr-team

Let your coding agents talk to each other in [Herdr](https://herdr.dev).
Ask Claude to get Codex's opinion, have a reviewer check a design, or bring a team together for a task. You keep talking to each agent in its own pane; herdr-team delivers messages between them.

Each Herdr workspace has its own room. Agents only join when you ask them to. Everything runs locally, with no server to manage.

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

## Try it

Open two agents in the same Herdr workspace. In each agent's pane, paste this:

> Run `herdr-hub join -d "helps with code review"` and follow the instructions it prints.

Without the PATH setup, use `<plugin_root>/dist/herdr-hub`, where `plugin_root` comes from `herdr plugin list --plugin herdr-team --json`.

Give each agent a description that fits its role. Once their turns finish, they join the room and learn each other's handles, such as `@claude` and `@codex`.

Then ask one of them:

> Ask @codex to review the cache design and tell me what it thinks.

Messages arrive in the other agent's pane when it is ready. You can watch the conversation there and keep giving tasks as usual.

**To stop the conversation**, tell an agent to stop replying, ask it to run `leave`, or close its pane. Agents can keep waking each other and spending tokens until one stops.

## Commands

Agents use the full path to `dist/herdr-hub`. For short commands and Tab completion in your own shell, use the [PATH setup above](#add-the-commands-to-path-zsh).

| Command | Use it to… |
|---|---|
| [`join [agent]`](docs/commands/hub/join.md) | Have a running agent join the room, optionally using a saved definition. |
| [`message`](docs/commands/hub/message.md) | Send a message or attach files. `--to` selects recipients; without it, everyone else receives it. |
| [`guide`](docs/commands/hub/guide.md) | Remind an agent how to use the room. |
| [`leave`](docs/commands/hub/leave.md) | Have an agent leave the conversation. |
| [`invite [agent]`](docs/commands/hub/invite.md) | Start a new agent in a shell pane and bring it into the room. |
| [`agents`](docs/commands/hub/agents.md) | List saved agent definitions. |
| [`status`](docs/commands/hub/status.md) | See who's in the room and why messages may be waiting. |
| [`tick`](docs/commands/hub/tick.md) | Process membership and deliveries. Herdr runs this automatically. |

## Reuse agents and teams

Save an agent's role, model, and instructions as a Markdown definition in `~/.config/herdr-team/agents/`. Then ask a running agent to `join reviewer`, or start one from a shell with `invite reviewer`. See [agent definitions](docs/commands/hub/join.md#joining-as-a-definition).

For a repeatable team with its own pane layout, use [compose](docs/compose.md) and the [example team](examples/team.yaml).

| Command | Use it to… |
|---|---|
| [`herdr-compose up [team]`](docs/commands/compose/up.md) | Start or update a team in separate lead and helper panes. Preview with `--dry-run`. |
| [`herdr-compose down [team]`](docs/commands/compose/down.md) | Close the team's lead and helper panes. |
| [`herdr-compose status`](docs/commands/compose/status.md) | See the teams running in this workspace. |
| [`herdr-compose teams`](docs/commands/compose/teams.md) | List saved team definitions. |

## More information

- [Setup and troubleshooting](docs/setup.md): shell completion, agent permissions, state location, and limits.
- [Development](docs/development.md): build, test, and contribute.
- [Design decisions](docs/adr/) and [glossary](GLOSSARY.md): how the pieces fit together.

The code is organized into five packages: [hub](packages/hub/) handles rooms and messages, [compose](packages/compose/) builds teams, [herdr](packages/herdr/) talks to Herdr, [agents](packages/agents/) reads definitions, and [terminal](packages/terminal/) handles terminal text. See the [code layout](docs/development.md#code-layout) for details.

Licensed under the [MIT License](LICENSE).
