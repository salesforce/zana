/**
 * Typed, deck-shaped wrappers over the control-plane ops. This is the ONE seam
 * where the physical deck meets Zana Command Center: every read the deck does
 * (poll the live agent list) and every write it does (message an agent, reply
 * to a blocked prompt) goes through here, so the rendering/interaction layers
 * never touch the wire protocol directly.
 *
 * Contrast with the showcase this is adapted from: it *inferred* status by
 * tailing ~/.claude logs and *acted* by focusing a window and injecting
 * keystrokes. Here state is authoritative (`agent.list` fuses live status) and
 * action is an explicit RPC addressed by stable handle/sessionId — no window,
 * no focus, no synthetic input.
 */

import { callControlPlane, type ControlClientResult } from './control-client.js';
import {
  isProjectItem,
  isScheduleItem,
  isStatusSummary,
  isSpawnProfileInfo,
  FALLBACK_SPAWN_PROFILES,
  type AgentListItem,
  type ProjectItem,
  type ScheduleItem,
  type SpawnProfile,
  type SpawnProfileInfo,
  type StatusSummary
} from './types.js';

export interface ZccSourceOpts {
  /** Data dir holding control.sock. Defaults to the resolved ~/.zcc. */
  dataDir?: string;
  /** Per-request timeout; the poll loop keeps this short so a hung app can't stall a tick. */
  timeoutMs?: number;
}

export class ZccSource {
  constructor(private readonly opts: ZccSourceOpts = {}) {}

  private call(op: string, args?: Record<string, unknown>): Promise<ControlClientResult> {
    return callControlPlane({
      op,
      args,
      dataDir: this.opts.dataDir,
      timeoutMs: this.opts.timeoutMs ?? 4_000
    });
  }

  /**
   * Live agent list with fused status. Returns `[]` (never throws) when the app
   * is down or the response is malformed — the deck degrades to an empty grid
   * rather than crashing the poll loop, matching the CLI's defensive contract.
   */
  async listAgents(): Promise<AgentListItem[]> {
    const res = await this.call('agent.list');
    if (!res.ok || !Array.isArray(res.value)) return [];
    return (res.value as unknown[]).filter(isAgentListItem);
  }

  /**
   * Live project list (the `project.list` op). Returns `[]` on any failure —
   * same defensive contract as `listAgents`, so a page fetch never throws.
   */
  async listProjects(): Promise<ProjectItem[]> {
    const res = await this.call('project.list');
    if (!res.ok || !Array.isArray(res.value)) return [];
    return (res.value as unknown[]).filter(isProjectItem);
  }

  /**
   * Live schedule list (the `sched.list` op). Returns `[]` on any failure.
   */
  async listSchedules(): Promise<ScheduleItem[]> {
    const res = await this.call('sched.list');
    if (!res.ok || !Array.isArray(res.value)) return [];
    return (res.value as unknown[]).filter(isScheduleItem);
  }

  /**
   * The harness profiles a fresh spawn may use (the `harness.list` op) — one
   * per enabled × installed harness family, so the project overlay only offers
   * launchers the machine can actually run. Falls back to the guaranteed
   * `claude` / `claude-yolo` baseline when the op is unknown (an app too old to
   * implement it) or returns nothing, so the overlay is never left button-less.
   */
  async listSpawnProfiles(): Promise<SpawnProfileInfo[]> {
    const res = await this.call('harness.list');
    if (!res.ok || !Array.isArray(res.value)) return [...FALLBACK_SPAWN_PROFILES];
    const rows = (res.value as unknown[]).filter(isSpawnProfileInfo);
    return rows.length ? rows : [...FALLBACK_SPAWN_PROFILES];
  }

  /**
   * Fleet overview (the `status` op): project count + live agents + enabled
   * schedules. Returns null when the app is down or the shape is unexpected, so
   * the status page can show a "no data" state rather than fabricated zeros.
   */
  async getStatus(): Promise<StatusSummary | null> {
    const res = await this.call('status');
    return res.ok && isStatusSummary(res.value) ? res.value : null;
  }

  /**
   * Send a peer message to an agent, addressed by handle or sessionId (mirrors
   * the `agent_send` MCP tool). Operator-class op — succeeds because a hardware
   * button carries no `ZCC_SESSION_ID` and is thus treated as the operator.
   */
  sendToAgent(to: string, message: string): Promise<ControlClientResult> {
    return this.call('agent.send', { to, message });
  }

  /**
   * Spawn a new agent into a project (the `term.create` op). The profile is
   * constrained to the two everyday interactive ones; `cwd` is confined
   * server-side to the registered project, so the deck passes only ids.
   */
  spawnAgent(projectId: string, profile: SpawnProfile): Promise<ControlClientResult> {
    return this.call('term.create', { projectId, profile });
  }

  /** Fire a schedule immediately (the `sched.runNow` op). */
  runScheduleNow(id: string): Promise<ControlClientResult> {
    return this.call('sched.runNow', { id });
  }

  /** Enable or disable a schedule (the `sched.setEnabled` op). */
  setScheduleEnabled(id: string, enabled: boolean): Promise<ControlClientResult> {
    return this.call('sched.setEnabled', { id, enabled });
  }

  /**
   * Inject a line at a session's prompt (the `reply()` primitive). This is the
   * path for approving/answering a *blocked* agent — e.g. reply "y" to a pending
   * permission prompt — since it lands text directly at that session's pty.
   */
  replyToSession(sessionId: string, text: string): Promise<ControlClientResult> {
    return this.call('term.reply', { sessionId, text });
  }

  /**
   * Reveal an agent in the ZCC desktop app — bring the window forward and open
   * that agent's modal (the `agent.focus` op). Unlike every other op here this
   * one is *pure UI*: it doesn't touch the agent's pty, it just drives the
   * renderer via a broadcast so a hardware press can pull the human's eyes to
   * the right session. Fails soft (like the rest) when the app is down.
   */
  focusAgent(sessionId: string, projectId: string): Promise<ControlClientResult> {
    return this.call('agent.focus', { sessionId, projectId });
  }
}

function isAgentListItem(v: unknown): v is AgentListItem {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return typeof a.sessionId === 'string' && typeof a.projectId === 'string';
}
