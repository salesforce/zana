import type { AgentSoundKind, AgentState, AppConfig } from '@zana-ai/zcc-domain/product';
import { normalizeAgentSoundVolume, notificationSoundProvider, notificationSoundsEnabled } from '@zana-ai/zcc-domain/product';

export const AGENT_SOUND_IDLE_DELAY_MS = 5_000;
const MAX_AGENTS = 1_000;

/** One main-process owner for all windows. No replay of existing resting agents. */
export class AgentSounds {
  private stopped = false;
  private agents = new Map<string, { state: AgentState; timer?: ReturnType<typeof setTimeout> }>();
  private lastPlayed = -Infinity;
  private lastKind?: AgentSoundKind;
  constructor(private deps: {
    config(): Pick<AppConfig, 'agentSoundDone' | 'agentSoundIdle' | 'agentSoundNeedsYou' | 'agentSoundVolume' | 'agentSoundSpacingSeconds' | 'notificationSoundsEnabled' | 'notificationSoundProvider'>;
    play(kind: AgentSoundKind, volume: number): void;
  }) {}

  observe(id: string, state: AgentState): void {
    if (this.stopped) return;
    if (state === 'done' && !this.enabled('done')) state = 'idle';
    const previous = this.agents.get(id);
    if (previous?.state === state) return;
    if (previous?.timer) clearTimeout(previous.timer);
    if (!previous && this.agents.size >= MAX_AGENTS) this.remove(this.agents.keys().next().value!);
    const entry = { state, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.agents.set(id, entry);
    // The first observation is a baseline, including after reconnect or restart.
    if (!previous) return;
    if (state === 'blocked') this.play('needs-you');
    else if (state === 'done' && (previous.state === 'working' || previous.state === 'idle') && this.enabled('done')) this.play('done');
    else if ((state === 'idle' || state === 'done') && previous.state === 'working' && this.enabled('idle')) {
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        this.play('idle');
      }, AGENT_SOUND_IDLE_DELAY_MS);
    }
  }

  remove(id: string): void {
    const entry = this.agents.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.agents.delete(id);
  }

  refresh(): void {
    if (this.enabled('idle')) return;
    for (const entry of this.agents.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  resetThreads(): void {
    for (const id of this.agents.keys()) if (id.startsWith('thread:')) this.remove(id);
  }

  shutdown(): void {
    this.stopped = true;
    for (const id of this.agents.keys()) this.remove(id);
    this.lastPlayed = -Infinity;
    this.lastKind = undefined;
  }

  private enabled(kind: AgentSoundKind): boolean {
    const config = this.deps.config();
    return notificationSoundProvider(config) === 'builtin' && notificationSoundsEnabled(config)
      && (kind === 'done' ? config.agentSoundDone : kind === 'idle' ? config.agentSoundIdle : config.agentSoundNeedsYou) === true;
  }

  private play(kind: AgentSoundKind): void {
    if (!this.enabled(kind)) return;
    const volume = normalizeAgentSoundVolume(this.deps.config().agentSoundVolume);
    if (volume === 0) return;
    const now = Date.now();
    const spacing = this.deps.config().agentSoundSpacingSeconds;
    const cooldown = (typeof spacing === 'number' && Number.isFinite(spacing) ? Math.max(2, Math.min(60, spacing)) : 2) * 1000;
    // A new input request can interrupt a completion/idle cue; repeated requests coalesce.
    if (now - this.lastPlayed < cooldown && !(kind === 'needs-you' && this.lastKind !== 'needs-you')) return;
    this.lastPlayed = now;
    this.lastKind = kind;
    try { this.deps.play(kind, volume); } catch { /* Audio is best effort. */ }
  }
}
