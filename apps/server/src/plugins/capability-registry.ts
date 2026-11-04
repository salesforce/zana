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
    if (harness === 'codex') capabilityRegistry.register(key, 'tool-before-native', { available: true });
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
for (const harness of ['claude', 'codex']) {
  for (const headless of [false, true]) {
    const key: CapabilitySurfaceKey = { surface: 'pty', harness, headless, hookBase: true };
    capabilityRegistry.register(key, 'tool-before-native', { available: true });
    capabilityRegistry.register(key, 'tool-after-native', { available: false, reason: 'Native tool completion is not delivered to plugins' });
  }
}

export function terminalCapabilityKey(session: { profile: string; headless?: boolean; capabilitySurface?: CapabilitySurfaceKey }): CapabilitySurfaceKey {
  if (session.capabilitySurface) return session.capabilitySurface;
  // Launch profile spelling is a host-owned enum; an unknown profile remains unsupported.
  const harness = /^(claude|codex|opencode|cursor|pi)(?:-resume|-yolo)?$/.exec(session.profile)?.[1] ?? session.profile;
  return { surface: 'pty', harness, headless: session.headless === true, hookBase: false };
}
