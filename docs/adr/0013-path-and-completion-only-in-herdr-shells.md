# PATH and completion only in Herdr shells, from hand-written zsh scripts

Typing `<repo>/dist/herdr-hub` by hand is tedious for users, so `shell/init.zsh` puts the plugin's
`dist/` on PATH and loads completion for both executables. Users source it from `.zshrc` behind
`[[ -n $HERDR_ENV ]]`, so it takes effect only in Herdr panes, where the commands mean something.
Installing into `~/.local/bin` or Homebrew was set aside: it reaches every shell, and needs a
release pipeline the plugin doesn't have. Herdr offers no pane-init hook that could do it instead:
plugin hooks run as separate processes and can't change a pane's shell.

Agents still get the full path in everything hub prints. They don't read `.zshrc` the same way,
and their sandboxes and allowlists (`Bash(<repo>/dist/herdr-hub:*)`) name the path.

The completion is hand-written zsh rather than generated from Commander: zsh's `_arguments` gives
better results than a generic generator, and only zsh is needed so far. Drift is caught by
`tests/shell/zsh.test.ts`, which compares each script with its program's visible commands and
options. Values only the program knows (definitions, handles, teams) come from a hidden
`__complete` command, so the scripts never parse JSON.

## Consequences

- Changing a command or option means changing `shell/zsh/` too; the test fails until it does.
- Another shell gets its own scripts and its own check in that test.
