/**
 * `@zcc/harness-sdk` — the dependency-free contracts for DESCRIBING a
 * coding-agent harness (Claude Code, Codex, Gemini, …). It ships ONLY the pieces
 * that import nothing from the app: capability descriptors and the harness-agnostic
 * action protocol. It deliberately does NOT ship the surfaces
 * (`LaunchSurface`/`ChatSurface`) or their app-coupled I/O types (`AutoModeInput`,
 * `ResolvedLaunch`, `HarnessRunRequest`, …) — those carry `AppConfig`/`Persona`/pi
 * types and stay in `src/main`. Nor the concrete providers, `PtyManager`,
 * terminal-launch internals, or the byte-sensitive argv assembly (`spawn-plan.ts`).
 *
 * This is the harness twin of `@zana-ai/zcc-extension-sdk`: because it's electron-free and
 * harness-agnostic, `npm publish` works the day we choose (it exposes only the
 * abstraction, never the proprietary Claude/Codex argv). `private:true` until then.
 *
 * A build guard (`packages/harness-sdk/src/__tests__/no-app-imports.test.ts`)
 * fails if anything here grows an electron / node-pty / `@shared` / AppConfig
 * import — the boundary that keeps the package genuinely standalone.
 */

export type { HarnessCapabilities, HookKind } from './capabilities.js';
export { LEAST_CAPABLE } from './capabilities.js';

export type {
  AgentAction,
  AgentActionKind,
  AgentActionResult,
  ExecAction,
  ReadFilesAction,
  WriteFileAction,
  EditFilesAction,
  GrepAction,
  GlobAction,
  McpCallAction,
  ReadMcpResourceAction,
  SpawnChildAction,
  AskUserAction
} from './actions.js';
export { assertNeverAction } from './actions.js';
