# A member is identified by the pane it was launched in

An agent's commands identify it by `HERDR_PANE_ID` from its environment, fixed when the agent
started; Herdr follows the agent itself by terminal, so a moved pane keeps its membership and
deliveries. Storing the current pane as well was dropped: the environment can't change, so a second
pane column only added a way for the two to disagree. Membership belongs to the pane: replacing its agent or starting a new conversation keeps its
handle and role. Deliveries go to whichever recognized agent is there now. If none is present,
queued posts are dropped and their authors told; busy and blocked agents keep their queues.

This replaces the original session-bound rule, which removed a member on an agent or session
change. Pane membership avoids requiring rejoining after every restart.
