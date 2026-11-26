# Maintaining bot behavior

How every bot communicates (brevity, outcome first, no repeats) lives in one place: [src/guidelines.ts](src/guidelines.ts). Tune it there, not per role. It is injected into every role after the personality, so a personality can override length and tone. It is TypeScript so it compiles into `server.mjs`.

Edit [src/instructions.ts](src/instructions.ts) for role-specific guidance. It contains the main-thread, background-job and routine-run instructions, the wrapper for user-authored personalities, and descriptions for each model-facing tool. A role change belongs in the corresponding function. Keep user-authored text inside the personality markers. The main-thread prompt and the routine tool both teach the model when a direct action fits.

[server.ts](server.ts) registers the instruction provider. [src/service.ts](src/service.ts) resolves the role from trusted spawn metadata on the first turn and the bot registry afterward. Tool schemas and role selection live in [src/tools.ts](src/tools.ts) and the Vault registration lives in [src/vault/register.ts](src/vault/register.ts). Enforce permissions in the service or tool handler.

Direct routines execute reviewed code in [src/direct-routines.ts](src/direct-routines.ts). Add configuration and validation to [src/model.ts](src/model.ts), expose it through the editor, CLI and tool schema, and cover the normal timer path. Post output with the display-only SDK method. Sending a prompt starts a model turn.

AI (`kind: "agent"`) routines run quietly: each firing spawns a hidden thread with no `parentThreadId` (a parent would be woken on every child turn) and `botRole: "routine"`, with at most one run in flight per routine. On `thread.idle`/`thread.failed` the service settles the run once: an answer of exactly `NO_CHANGE` records "quiet" and posts nothing, anything else is posted display-only to the main thread and kept as `lastResult` for the next run's prompt. Hosts without `postMessage` fall back to delivering the prompt into the main thread.

Changing another bot from a thread needs a person's approval: through the `bot_routines` tool (which asks) or an existing manage grant. A thread's `zcc bots` shell never approves on its own. A bot never routes another bot's or a thread's work to a person: a bot main thread cannot change another bot at all (it messages that bot instead), and the instructions and errors say so rather than asking for approval.

Instructions are read when a thread starts, and the conversation keeps the old role, so a name or personality edit on a bot with a live main thread sets `roleChanged`. The next delivery carries a trusted `roleChangeNotice` in its agent context (never in a message body, which bots must treat as untrusted), then clears the flag.

Run the focused suite with `pnpm exec vitest run plugins/bots`. The private Electron check is `pnpm test:e2e -- e2e/bots-workbench.spec.ts`.
