import type { PluginAgentActivitySnapshot } from '@zana-ai/zcc-plugin-sdk/app';
import type { Cue, Preferences } from './model.js';

export const IDLE_SETTLE_MS = 5000;
export const NEEDS_YOU_COOLDOWN_MS = 3000;

/** Replace this module to change the rules. All instances are bounded and disposable. */
export class SoundPolicy {
  private states = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastPlayed = -Infinity;
  private lastNeedsYou = -Infinity;
  constructor(private config: () => Preferences, private play: (cue: Cue) => void) {}
  observe(snapshot: PluginAgentActivitySnapshot): void {
    if (!snapshot.ready) { this.reset(); return; }
    const present = new Set<string>();
    for (const agent of snapshot.agents.slice(0, 1000)) {
      const key = `${agent.kind}:${agent.id}`;
      present.add(key);
      const before = this.states.get(key);
      this.states.set(key, agent.state);
      if (before === undefined || before === agent.state) continue;
      this.cancel(key);
      if (agent.state === 'needs-you') this.cue('needs-you');
      else if (agent.state === 'idle' && before === 'working' && this.allowed('idle')) {
        this.timers.set(key, setTimeout(() => {
          this.timers.delete(key);
          if (this.states.get(key) === 'idle') this.cue('idle');
        }, IDLE_SETTLE_MS));
      }
    }
    for (const key of this.states.keys()) if (!present.has(key)) { this.cancel(key); this.states.delete(key); }
  }
  private allowed(cue: Cue): boolean {
    const p = this.config();
    return p.enabled && p.volume > 0 && (cue === 'idle' ? p.idle : p.needsYou);
  }
  private cue(cue: Cue): void {
    if (!this.allowed(cue)) return;
    const now = Date.now();
    if (cue === 'needs-you') {
      if (now - this.lastNeedsYou < NEEDS_YOU_COOLDOWN_MS) return;
      this.lastNeedsYou = now;
    } else if (now - this.lastPlayed < this.config().idleSpacingSeconds * 1000) return;
    this.lastPlayed = now;
    this.play(cue);
  }
  private cancel(key: string): void { clearTimeout(this.timers.get(key)); this.timers.delete(key); }
  refresh(): void { for (const key of this.timers.keys()) this.cancel(key); }
  reset(): void { this.refresh(); this.states.clear(); }
  dispose(): void { this.reset(); }
}
