# A room is a Herdr workspace

Each Herdr workspace has exactly one room, keyed by Herdr's workspace ID; agents never name a room,
and there is no rooms table. Joining, posting and leaving act on the caller's workspace, which keeps
the agent-facing commands free of room arguments and makes "which room?" impossible to get wrong.
Rooms spanning workspaces, or several rooms in one workspace, would need room names in every command.
