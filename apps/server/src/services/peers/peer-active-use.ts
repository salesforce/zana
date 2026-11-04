/** A plugin counts as transferring with a computer while its last successful `peers.call` is this recent. */
export const ACTIVE_USE_WINDOW_MS = 10_000;
/** Most (plugin, computer) pairs remembered; the oldest drops first. */
export const ACTIVE_USE_MAX = 1024;

const key = (pluginId: string, computerId: string) => `${pluginId}\u0000${computerId}`;

/**
 * Core-observed active use: core records each successful `peers.call` itself, so a plugin cannot claim or hide
 * activity. Failed calls are never recorded. In memory only; it only drives a "Stop anyway?" confirm.
 */
export class PeerActiveUse {
  private readonly last = new Map<string, { pluginId: string; computerId: string; at: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  recordSuccess(pluginId: string, computerId: string): void {
    const id = key(pluginId, computerId);
    this.last.delete(id);
    this.last.set(id, { pluginId, computerId, at: this.now() });
    if (this.last.size > ACTIVE_USE_MAX) this.last.delete(this.last.keys().next().value!);
  }

  isActive(pluginId: string, computerId: string): boolean {
    const entry = this.last.get(key(pluginId, computerId));
    return !!entry && this.now() - entry.at < ACTIVE_USE_WINDOW_MS;
  }

  /** Plugins transferring with this computer right now, oldest call first. */
  activePlugins(computerId: string): string[] {
    const now = this.now();
    const active: string[] = [];
    for (const [id, entry] of this.last) {
      if (now - entry.at >= ACTIVE_USE_WINDOW_MS) { this.last.delete(id); continue; }
      if (entry.computerId === computerId) active.push(entry.pluginId);
    }
    return active;
  }

  forgetUse(pluginId: string, computerId: string): void { this.last.delete(key(pluginId, computerId)); }

  forget(computerId: string): void {
    for (const [id, entry] of this.last) if (entry.computerId === computerId) this.last.delete(id);
  }
}
