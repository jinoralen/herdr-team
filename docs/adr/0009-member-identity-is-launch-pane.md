# A member is identified by the pane it was launched in

An agent's commands identify it by `HERDR_PANE_ID` from its environment, fixed when the agent
started; Herdr follows the agent itself by terminal, so a moved pane keeps its membership and
deliveries. Storing the current pane as well was dropped: the environment can't change, so a second
pane column only added a way for the two to disagree. A new agent session in the same terminal is a
different conversation that never saw the room's rules, so that member is removed.
