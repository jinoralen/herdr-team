# A member is identified by the pane it joined from

Membership belongs to the pane: replacing its agent, or starting a new conversation in it, keeps its
handle and role, and deliveries go to whichever recognized agent is there now. The member leaves the
room when its pane closes or moves to another workspace (or by `leave`).

Agents' commands identify the member by `HERDR_PANE_ID` from their environment, and ticks by the
pane's ID in Herdr's list. The two agree as long as the pane stays in its workspace, where Herdr
keeps its ID. Moved to another workspace, the pane gets a new ID, and an agent started there would
have a different pane and room in its environment than the member: rather than track the pane
across rooms, the member is removed, and nothing joins the new room by itself.

While no recognized agent is in the pane, its posts are dropped and their authors told, rather than
held for an agent that may never come back; busy and blocked agents keep their queues.

This replaces the first version of this decision, which bound a member to its agent and session and
removed it when either changed: every agent restart then meant joining again.
