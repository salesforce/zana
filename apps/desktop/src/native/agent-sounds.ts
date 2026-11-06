import type { AgentSoundKind, AgentState, AppConfig } from '@zana-ai/zcc-domain/product';
import { normalizeAgentSoundVolume } from '@zana-ai/zcc-domain/product';

export const AGENT_SOUND_IDLE_DELAY_MS = 5_000;
const MAX_AGENTS = 1_000;
const COOLDOWN_MS = 2_000;

/** One main-process owner for all windows. No replay of existing resting agents. */
export class AgentSounds {
  private stopped = false;
  private agents = new Map<string, { state: AgentState; timer?: ReturnType<typeof setTimeout> }>();
  private lastPlayed = new Map<AgentSoundKind, number>();
  constructor(private deps: {
    config(): Pick<AppConfig, 'agentSoundIdle' | 'agentSoundNeedsYou' | 'agentSoundVolume'>;
    play(kind: AgentSoundKind, volume: number): void;
  }) {}

  observe(id: string, state: AgentState): void {
    if (this.stopped) return;
    if (state === 'done') state = 'idle';
    const previous = this.agents.get(id);
    if (previous?.state === state) return;
    if (previous?.timer) clearTimeout(previous.timer);
    if (!previous && this.agents.size >= MAX_AGENTS) this.remove(this.agents.keys().next().value!);
    const entry = { state, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.agents.set(id, entry);
    // The first observation is a baseline, including after reconnect or restart.
    if (!previous) return;
    if (state === 'blocked') this.play('needs-you');
    else if (state === 'idle' && previous.state === 'working' && this.enabled('idle')) {
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
    this.lastPlayed.clear();
  }

  private enabled(kind: AgentSoundKind): boolean {
    const config = this.deps.config();
    return (kind === 'idle' ? config.agentSoundIdle : config.agentSoundNeedsYou) === true;
  }

  private play(kind: AgentSoundKind): void {
    if (!this.enabled(kind)) return;
    const volume = normalizeAgentSoundVolume(this.deps.config().agentSoundVolume);
    if (volume === 0) return;
    const now = Date.now();
    if (now - (this.lastPlayed.get(kind) ?? -Infinity) < COOLDOWN_MS) return;
    this.lastPlayed.set(kind, now);
    try { this.deps.play(kind, volume); } catch { /* Audio is best effort. */ }
  }
}
