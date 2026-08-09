# Chat Delegation Policy

Coordinator Chat may automatically spawn or route up to five workers per run
when the Chat is scoped to exactly one registered project.

Approval is still required for team launches, deliberation, cross-project work,
agent/team stops, all workspace mutations, fan-out beyond five, and delegation
from Engineer Chat. Children do not inherit remembered shell/write approvals.

Approval requests are displayed one at a time with a queue counter. Actions are
explicit: Approve once, Allow for this chat, or Deny. Spawn-agent calls use a
typed schema requiring `profileId` and `prompt`; the Coordinator is instructed to
call `zana_list_profiles` before spawning when it needs a profile.

New Chat sessions have no title or mode form. They start as the standard ZCC
Agent with all-project scope, are named from the first message through the shared
`builtin:tab-namer` prompt, and expose Scope as an in-session Context control.

Every Chat also owns a stable workspace at
`~/zcc-workspace/conversations/<conversation-id>/`. The Context row exposes the
short conversation id and a reveal action. All/multi-project Chat tools use this
folder as their confined working directory; single-project Chat continues to use
the selected project root for direct code work.
