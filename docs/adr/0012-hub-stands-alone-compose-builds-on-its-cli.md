# Hub stands alone; compose builds on its CLI

Rooms are useful without teams, so the project ships two executables rather than one: `herdr-hub`
(rooms: joining, messages, delivery, starting one agent with `invite`) and `herdr-compose` (teams,
layouts, deployments). Hub knows nothing of compose. Compose reaches hub only by running its
command line: `invite` to start helpers and the lead, and `status --json` to read membership. It
never opens hub's database, and hub never opens compose's. One executable with both command sets
was considered and set aside: it is simpler to install, but every user of rooms would carry, and
every agent reading help would see, the team commands.

The two share one namespace, named for the project: the plugin id `herdr-team`, the config folder
`~/.config/herdr-team/` (`agents/` read by hub, `teams/` read by compose), and `HERDR_TEAM_*`
variables. State has one base folder with a subfolder per layer, each owned by its layer alone.
Definitions are hub's: starting one agent from a file needs no team.

## Consequences

- `status --json` and `invite`'s options and exit codes are a contract; 75 means "retry after a
  tick" in both, and compose passes hub's on. The JSON is unversioned; compose validates the
  fields it reads, and a test pins what compose depends on.
- Both executables come from one build. A mismatch only happens when `HERDR_TEAM_HUB_BIN` points
  compose at another build, and compose names it when the JSON doesn't parse.
- A feature that needs both layers goes into hub's CLI first, then compose uses it.
