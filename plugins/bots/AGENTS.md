# Maintaining bot behavior

Edit [src/instructions.ts](src/instructions.ts) for the developer guidance read by every bot. It contains the main-thread and background-job instructions, the wrapper for user-authored personalities, and descriptions for each model-facing tool. A role change belongs in the corresponding function. Keep user-authored text inside the personality markers. The main-thread prompt and the routine tool both teach the model when a direct action fits.

[server.ts](server.ts) registers the instruction provider. [src/service.ts](src/service.ts) resolves the role from trusted spawn metadata on the first turn and the bot registry afterward. Tool schemas and role selection live in [src/tools.ts](src/tools.ts) and the Vault registration lives in [src/vault/register.ts](src/vault/register.ts). Enforce permissions in the service or tool handler.

Direct routines execute reviewed code in [src/direct-routines.ts](src/direct-routines.ts). Add configuration and validation to [src/model.ts](src/model.ts), expose it through the editor, CLI and tool schema, and cover the normal timer path. Post output with the display-only SDK method. Sending a prompt starts a model turn.

Run the focused suite with `pnpm exec vitest run plugins/bots`. The private Electron check is `pnpm test:e2e -- e2e/bots-workbench.spec.ts`.
