# Thread peer communication

Settings → Experimental → Thread communication controls the bridge between
native threads and other threads or CLI Agents. It is **enabled by default**.
An explicit off setting is preserved. Every message needs user review before
it reaches the recipient; enabling the experiment does not approve messages.
Existing CLI-to-CLI messaging keeps its current behavior.

Threads receive `register_agent`, `list_agents`, `find_agent`, `agent_send`,
and `agent_inbox`. A stable registered handle survives title changes. A raw
session ID provides unambiguous addressing. Discovery and sending are limited
to the same project; `allProjects: true` is rejected by this bridge. Hidden,
archived and stopping native threads and squad workers are excluded. Lists
return at most 200 peers; a known eligible thread ID can still be addressed.

`agent_send` returns `delivery: awaiting-review`. The body is stored durably,
separate from model context, the recipient inbox and the runnable turn queue.
Review it in the recipient thread, or in the sending thread for a CLI target.
The card shows the sender, recipient and full body, with **Deliver** and
**Discard**. Deliver opens a confirmation owned by Electron main. Main reads
the stored content and revision again before signing a single-use approval.
Authenticated mobile delivery uses the existing phone confirmation path.
Agents and renderer JSON cannot mint delivery approval.

After approval, a native recipient receives the immutable message through its
durable next-turn queue. A busy thread waits until its current turn ends.
A busy CLI recipient keeps the message in review and reports that it must be
delivered again when idle. Successful CLI injection is recorded as delivered
so its mailbox cannot deliver the body a second time. Discard never starts a
turn. Transport errors leave the durable review available for inspection;
approved native sends also use the ordinary queue's failure/retry UI.

Stop pauses the native recipient even when its queue is empty and revokes
pending approvals. Resume or an ordinary user send does not approve peer
content. Turning the experiment off blocks new native participation and
pending dispatch. Turning it on again requires fresh review, enforced by a
host-owned configuration generation. These controls cannot retract content
already accepted or undo work already running. Stop controls an active turn.
Old queued bridge messages without a review are quarantined for review.

Received conversation messages show their source. Native sender names link
to their thread; CLI senders are labeled separately. The host supplies identity
from registered sessions. Peer delivery can start work using the recipient's
existing tools and permissions, so review is a control over exposure, not a
claim that peer instructions are benign or an expansion of tool authority.
The feature mediates product messaging; full-trust local shell access is not
an OS security sandbox.

Each thread retains at most 50 unresolved reviews and approximately 150 terminal
review records. Coordination events are separately bounded; `agent_inbox`
returns up to 50 delivered records and advances its read cursor. Normal
conversation history follows existing retention. Native senders are limited
to 30 messages per minute and an eight-hop envelope limit. There are no
automatic peer connections in this version.

Verification: focused service, API, configuration, trusted confirmation and UI
tests cover default-on behavior, opt-out, scope, identity, persistence, limits,
revision checks, discard, Stop, off/on and concurrent approval. Run
`pnpm test:e2e -- e2e/thread-peer-communication.spec.ts` for the built Electron
flow, real PTY/MCP delivery, payloads above 8 KB, confirmation cancellation,
unsigned approval rejection, attribution and stop/resume. Required broader
checks are `pnpm verify:fast`, then the live commands in
`docs/live-zana-verification.md`.
