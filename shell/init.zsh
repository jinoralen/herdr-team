# herdr-team in Herdr panes: puts herdr-hub and herdr-compose (this plugin's dist/) on PATH and
# loads their completion. Source it from ~/.zshrc, inside Herdr only:
#
#   [[ -n $HERDR_ENV ]] && source <plugin root>/shell/init.zsh
#
# Before or after compinit both work: before, compinit finds the completions on fpath; after,
# they are registered here.
() {
  local root=${1:A:h:h}
  [[ :$PATH: == *:$root/dist:* ]] || path=($root/dist $path)
  fpath=($root/shell/zsh $fpath)
  if (( $+functions[compdef] )); then
    autoload -Uz _herdr-hub _herdr-compose
    compdef _herdr-hub herdr-hub -p '*/herdr-hub'
    compdef _herdr-compose herdr-compose -p '*/herdr-compose'
  fi
} ${(%):-%x}
