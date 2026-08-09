/**
 * Harness capability descriptor — the runtime-detected contract that lets core
 * degrade gracefully when a harness (Codex, Gemini, …) can't match Claude Code's
 * full feature set.
 *
 * Capabilities are DETECTED AT RUNTIME via a capability-probe pattern, NOT
 * hardcoded per-CLI tier. Core must consult this descriptor and degrade
 * gracefully — no resume when `supportsResume: false`, no hooks when
 * `supportsHooks` is empty, no MCP injection when `supportsMcp: false` (already
 * the remote-SSH behavior today, a proven degradation path). Every field defaults
 * to the LEAST capable answer (empty sets, all booleans false) so a half-built
 * harness is safe and degrades predictably, never crashes. The degradation table
 * (architect.md §4):
 *  - !supportsResume → restore relaunches cold; UI hides "resume"
 *  - !supportsAutoMode → fall back to concrete permissionMode; skip auto-mode env
 *  - empty supportsHooks → core emits no --settings block; scheduler "turn ended"
 *    falls back to process-exit (already the `reapDeadSessions` fallback)
 *  - !supportsMcp → no --mcp-config; inbox/zana tools unavailable (remote-SSH today)
 *  - !supportsTranscript → past-conversation picker empty; title falls back
 *  - !acceptsPositionalPrompt → `resolvePersonaLaunch` injects via pty write
 *  - !isNodeProcess → skip NODE_OPTIONS heap ceiling
 *
 * This descriptor defines one canonical capability shape. The harness seam
 * consumes it as a type-locked contract for provider integrations.
 */

export type HookKind = 'stop' | 'notify' | 'firstPrompt' | 'subagent' | 'overseer';

/**
 * What a harness CAN do. Core reads this to degrade gracefully. Every field
 * defaults to the LEAST capable answer so a partially-built harness is safe.
 */
export interface HarnessCapabilities {
  /** true for agent CLIs (claude, codex, gemini); false for shell */
  readonly isAgent: boolean;
  /** true when the CLI supports resume-by-id (claude's --resume <uuid>) */
  readonly supportsResume: boolean;
  /** true when the CLI writes a readable on-disk transcript (claude's ~/.claude/projects/*.jsonl) */
  readonly supportsTranscript: boolean;
  /** true when the CLI accepts --mcp-config <path> (or equivalent) */
  readonly supportsMcp: boolean;
  /** Which hook kinds this CLI can wire (claude: all; a stateless CLI: none) */
  readonly supportsHooks: ReadonlySet<HookKind>;
  /** true when the CLI supports auto mode (claude's classifier-backed --permission-mode auto) */
  readonly supportsAutoMode: boolean;
  /** Which permission modes this CLI accepts (e.g. ['default', 'acceptEdits', 'plan']) */
  readonly permissionModes: ReadonlySet<string>;
  /** true when the CLI accepts an opening prompt as a positional argv (claude does; some don't) */
  readonly acceptsPositionalPrompt: boolean;
  /** true when the CLI is a node process (NODE_OPTIONS heap ceiling applies) */
  readonly isNodeProcess: boolean;
  /**
   * true for the NATIVE in-process harness (the AI-SDK agent loop), false for
   * every CLI-subprocess harness. When true, core owns the loop rather than
   * shelling out — the two `owns*` flags below then say what that entails.
   */
  readonly isNative: boolean;
  /**
   * true when the harness executes tool calls ITSELF (native routes each action
   * through the broker-gated executor). false for CLI harnesses, which run tools
   * inside their own subprocess where core never sees them.
   */
  readonly ownsToolExecution: boolean;
  /**
   * true when the harness runs the permission/authz gate in-process (native:
   * `HarnessAuthz` decides approve/deny before executing). false for CLI
   * harnesses, which own their own permission prompt.
   */
  readonly ownsPermissionGate: boolean;
}

/**
 * The least-capable descriptor — everything off / empty sets. Harnesses default
 * to this so a half-built harness is safe and degrades predictably, never crashes.
 */
export const LEAST_CAPABLE: HarnessCapabilities = {
  isAgent: false,
  supportsResume: false,
  supportsTranscript: false,
  supportsMcp: false,
  supportsHooks: new Set(),
  supportsAutoMode: false,
  permissionModes: new Set(),
  acceptsPositionalPrompt: false,
  isNodeProcess: false,
  isNative: false,
  ownsToolExecution: false,
  ownsPermissionGate: false
};
