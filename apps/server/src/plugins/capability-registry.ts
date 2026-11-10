import type { CapabilityDescriptor, CapabilitySurfaceKey } from '@zana-ai/zcc-domain';

export const SURFACE_CAPABILITIES = ['message-admission', 'lifecycle-delivery', 'tool-before-native', 'tool-after-native', 'interactions'] as const;
type CapabilityId = typeof SURFACE_CAPABILITIES[number];
type State = { available: true; reason?: string } | { available: false; reason: string };
const keyId = (key: CapabilitySurfaceKey) => JSON.stringify([key.surface, key.harness, key.headless, key.hookBase]);

/** Host-owned wiring only. Missing registrations deny availability, never infer from family. */
export class CapabilityRegistry {
  private readonly entries = new Map<string, Map<CapabilityId, State>>();

  register(key: CapabilitySurfaceKey, id: CapabilityId, state: State): void {
    const identity = keyId(key);
    let entry = this.entries.get(identity);
    if (!entry) { entry = new Map(); this.entries.set(identity, entry); }
    entry.set(id, state);
  }

  describe(key: CapabilitySurfaceKey | null): CapabilityDescriptor[] {
    const entry = key ? this.entries.get(keyId(key)) : undefined;
    return SURFACE_CAPABILITIES.map(id => ({ id, ...(entry?.get(id) ?? {
      available: false, reason: key ? `${key.surface}/${key.harness}: ${id} is not wired` : 'no thread resolved'
    }) }));
  }
}

export const capabilityRegistry = new CapabilityRegistry();
const MODERN_CODEX_VETO_LIMIT = 'modern/codex: not advertised as a full veto. It is not proven live, and it covers commands and file changes Codex raises an approval for. That is every one at full permission scope; at workspace scope Codex raises none for a command that stays inside its sandbox, and automatic review settles approvals inside Codex. MCP tool calls and web search raise no approval and are never gated';
const MODERN_UNWIRED_VETO = 'modern/{harness}: no awaited native-policy transport is wired for this harness';
const ACP_CURSOR_VETO_LIMIT = 'modern/acp-cursor: permission requests Cursor raises over ACP are decided by host policy, but a tool it runs without raising a request is not gated, and request coverage is unverified against a logged-in cursor-agent';
// Exact bridge registrations; only the awaited native-policy transport can advertise a veto.
for (const harness of ['claude-code', 'codex', 'pi', 'acp', 'acp-opencode', 'acp-cursor']) {
  for (const headless of [false, true]) {
    const key: CapabilitySurfaceKey = { surface: 'modern', harness, headless, hookBase: true };
    capabilityRegistry.register(key, 'message-admission', { available: true });
    capabilityRegistry.register(key, 'lifecycle-delivery', { available: true });
    if (harness === 'claude-code') capabilityRegistry.register(key, 'tool-before-native', { available: true });
    // OBL-018/p0-modern-codex-veto: with approvalPolicy:"untrusted" codex raises an
    // approval for every command + file-change (even under danger-full-access), and the
    // bridge routes both through the host native-tool policy before execution
    // (provider-codex/src/bridge/bridge.ts routeCodexNativeToolPolicy). Web search and
    // MCP tool calls emit no client approval and remain outside the veto — documented,
    // not silently covered.
    if (harness === 'codex') capabilityRegistry.register(key, 'tool-before-native', { available: false, reason: MODERN_CODEX_VETO_LIMIT });
    if (harness === 'pi' || harness === 'acp' || harness === 'acp-opencode') capabilityRegistry.register(key, 'tool-before-native', { available: false, reason: MODERN_UNWIRED_VETO.replace('{harness}', harness) });
    // Cursor over ACP: permission requests the agent raises are decided by host policy
    // before any allow, but an agent running with permissions pre-granted raises none,
    // and no live Cursor login was available to prove which requests it raises. The
    // Modern veto therefore stays unadvertised for it.
    if (harness === 'acp-cursor') capabilityRegistry.register(key, 'tool-before-native', { available: false, reason: ACP_CURSOR_VETO_LIMIT });
    capabilityRegistry.register(key, 'interactions', headless ? { available: false, reason: 'Headless interaction presentation is unavailable' } : { available: true });
  }
}
// PTY message admission is wired in Electron main for the initial prompt, CLI Agent
// reply, and Job Team dispatch, and does not depend on the hook base. Raw keystrokes
// (`term.write`) are not dispatches and stay outside it.
for (const harness of ['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell']) {
  for (const headless of [false, true]) {
    for (const hookBase of [false, true]) {
      capabilityRegistry.register({ surface: 'pty', harness, headless, hookBase }, 'message-admission', { available: true });
    }
  }
}
// PTY lifecycle events: main reports a session's creation and its exit for every
// PTY, with the exit-derived failure. Active/idle ride the turn hooks, which only an
// interactive Claude or Codex session with a hook base carries, so the rest say so.
const PTY_LIFECYCLE_HOOKS = 'Delivers created and exit-derived failed/deleted events';
for (const harness of ['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell']) {
  for (const headless of [false, true]) {
    for (const hookBase of [false, true]) {
      const turnHooks = !headless && hookBase && (harness === 'claude' || harness === 'codex');
      capabilityRegistry.register({ surface: 'pty', harness, headless, hookBase }, 'lifecycle-delivery', turnHooks
        ? { available: true }
        : { available: true, reason: headless
          ? `${PTY_LIFECYCLE_HOOKS}; a headless session carries no turn hooks, so it never reports active or idle`
          : `${PTY_LIFECYCLE_HOOKS}; this session carries no turn hooks, so it never reports active or idle` });
    }
  }
}
// PTY interactions: `ui.requestInput` with a PTY session id as `threadId` is
// answered in the Agents monitor banner through the human-proof path. It needs a
// presented session (a headless one has no monitor to show it) and a session the
// server was told is live, which main reports on its created lifecycle event.
const PTY_INTERACTIONS = 'Shown as a banner on the session in the Agents monitor; a session is addressable once its created lifecycle event has been delivered';
for (const harness of ['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell']) {
  for (const headless of [false, true]) {
    for (const hookBase of [false, true]) {
      capabilityRegistry.register({ surface: 'pty', harness, headless, hookBase }, 'interactions', headless
        ? { available: false, reason: 'Headless interaction presentation is unavailable' }
        : { available: true, reason: PTY_INTERACTIONS });
    }
  }
}
// OpenCode's veto is a per-session plugin module its config names (its pre-tool
// hook runs ahead of every tool and is independent of permission rules, so an
// allow-all permission setting does not bypass it). It exists only on a local
// launch that wrote the module (hookBase), covers tools the agent runs, and
// does not gate a command the user types into the TUI.
const OPENCODE_PTY_VETO = 'Vetoes tools the agent runs through OpenCode\'s plugin pre-tool hook; a command the user types into the TUI is not gated, and a remote launch carries no veto';
// Cursor's veto is the blocking preToolUse hook of a per-session plugin directory
// (--plugin-dir), marked failClosed so a crash or timeout also denies. It runs
// ahead of every tool the agent calls (shell, MCP, file reads and writes). Not
// gated: a command the user types into the TUI, Tab completion edits, and a
// remote launch (no host-local directory to name).
const CURSOR_PTY_VETO = 'Vetoes tools the agent runs through Cursor\'s blocking preToolUse hook; a command the user types into the TUI and Tab completion edits are not gated, and a remote launch carries no veto. Not advertised: Cursor loading the per-session plugin directory has not been verified against a logged-in cursor-agent';
for (const harness of ['claude', 'codex', 'opencode', 'cursor']) {
  for (const headless of [false, true]) {
    const key: CapabilitySurfaceKey = { surface: 'pty', harness, headless, hookBase: true };
    capabilityRegistry.register(key, 'tool-before-native', harness === 'opencode' ? { available: true, reason: OPENCODE_PTY_VETO } : harness === 'cursor' ? { available: false, reason: CURSOR_PTY_VETO } : { available: true });
    capabilityRegistry.register(key, 'tool-after-native', { available: false, reason: 'Native tool completion is not delivered to plugins' });
  }
}

export function terminalCapabilityKey(session: { profile: string; headless?: boolean; capabilitySurface?: CapabilitySurfaceKey }): CapabilitySurfaceKey {
  if (session.capabilitySurface) return session.capabilitySurface;
  // Launch profile spelling is a host-owned enum; an unknown profile remains unsupported.
  const harness = /^(claude|codex|opencode|cursor|pi)(?:-resume|-yolo)?$/.exec(session.profile)?.[1] ?? session.profile;
  return { surface: 'pty', harness, headless: session.headless === true, hookBase: false };
}
